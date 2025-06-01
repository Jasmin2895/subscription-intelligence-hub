// frontend/src/components/DashboardPage.js
import React, { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
// import { Bar, Doughnut } from "react-chartjs-2"; // Remove react-chartjs-2
// import {
//   Chart as ChartJS,
//   CategoryScale,
//   LinearScale,
//   BarElement,
//   Title,
//   Tooltip,
//   Legend,
//   ArcElement,
// } from "chart.js"; // Remove chart.js

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts"; // Add recharts imports

// Register Chart.js components - REMOVE THIS SECTION
// ChartJS.register(
//   CategoryScale,
//   LinearScale,
//   BarElement,
//   Title,
//   Tooltip,
//   Legend,
//   ArcElement
// );

// Ensure this URL matches your Node.js backend's address and port
const API_URL = "http://localhost:3001"; // Change if your backend runs elsewhere

// Updated PIE_COLORS for better visibility and appeal on dark theme
const PIE_COLORS = [
  "#25C7D9", // Bright Cyan/Turquoise
  "#F25E7A", // Vibrant Pink/Coral
  "#4DD964", // Bright Green
  "#F2B705", // Bright Yellow/Orange
  "#A67AF2", // Bright Purple/Lavender
  "#F28322", // Bright Orange
  "#05AFF2", // Bright Blue
  "#D93D66", // Strong Magenta
  "#6BF2A3", // Mint Green
  "#F2D06B", // Light Gold
];

function DashboardPage() {
  const { userEmail } = useParams(); // Get the email from the URL parameter
  const [financialItems, setFinancialItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedItemId, setSelectedItemId] = useState(null); // Renamed from selectedItem
  const [upcomingRenewals, setUpcomingRenewals] = useState([]); // New state for upcoming renewals

  // Chart data states
  // const [monthlyExpenseData, setMonthlyExpenseData] = useState(null);
  // const [categoryExpenseData, setCategoryExpenseData] = useState(null);

  useEffect(() => {
    if (userEmail) {
      setIsLoading(true);
      setError("");
      setFinancialItems([]); // Clear previous items
      setUpcomingRenewals([]); // Clear previous renewals
      axios
        .get(
          `${API_URL}/api/data/${encodeURIComponent(userEmail)}/financial-items`
        )
        .then((response) => {
          setFinancialItems(response.data);
          // prepareChartData(response.data); // REMOVE: Prepare chart data after fetching

          // Calculate upcoming renewals
          const renewals = [];
          const now = new Date();
          const thirtyDaysFromNow = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000
          );
          response.data.forEach((item) => {
            if (
              item.purchase_date &&
              (item.billing_cycle === "monthly" ||
                item.billing_cycle === "annually")
            ) {
              let nextRenewal = new Date(item.purchase_date);
              if (item.billing_cycle === "monthly") {
                while (nextRenewal < now)
                  nextRenewal.setMonth(nextRenewal.getMonth() + 1);
              } else {
                // annually
                while (nextRenewal < now)
                  nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
              }
              if (nextRenewal <= thirtyDaysFromNow && nextRenewal >= now) {
                renewals.push({
                  ...item,
                  next_renewal_date_calc: nextRenewal
                    .toISOString()
                    .split("T")[0],
                });
              }
            }
          });
          setUpcomingRenewals(
            renewals.sort(
              (a, b) =>
                new Date(a.next_renewal_date_calc) -
                new Date(b.next_renewal_date_calc)
            )
          );

          setIsLoading(false);
        })
        .catch((err) => {
          console.error(
            `Error fetching financial items for ${userEmail}:`,
            err
          );
          if (err.response && err.response.status === 400) {
            setError(`Invalid request for ${userEmail}.`);
          } else {
            setError(
              `Failed to fetch data for ${userEmail}. Please ensure you've forwarded emails from this address and the backend is running.`
            );
          }
          setIsLoading(false);
        });
    }
  }, [userEmail]);

  const monthlyExpenseData = useMemo(() => {
    if (!financialItems || financialItems.length === 0) return null;
    const monthlyExpenses = {};
    financialItems.forEach((item) => {
      if (item.amount_display != null && item.purchase_date) {
        const monthYear = new Date(item.purchase_date).toLocaleDateString(
          "en-US",
          { year: "numeric", month: "short" }
        );
        monthlyExpenses[monthYear] =
          (monthlyExpenses[monthYear] || 0) +
          parseFloat(item.amount_display || 0);
      }
    });

    if (Object.keys(monthlyExpenses).length > 0) {
      const sortedMonths = Object.keys(monthlyExpenses).sort(
        (a, b) => new Date(a) - new Date(b)
      );
      return sortedMonths.map((month) => ({
        name: month,
        Spending: parseFloat(monthlyExpenses[month].toFixed(2)),
      }));
    }
    return null;
  }, [financialItems]);

  const categoryExpenseData = useMemo(() => {
    if (!financialItems || financialItems.length === 0) return null;
    const categoryExpenses = {};
    financialItems.forEach((item) => {
      if (item.amount_display != null) {
        let determinedCategory = "Unknown";
        if (item.category) {
          determinedCategory = item.category;
        }
        categoryExpenses[determinedCategory] =
          (categoryExpenses[determinedCategory] || 0) +
          parseFloat(item.amount_display || 0);
      }
    });

    if (Object.keys(categoryExpenses).length > 0) {
      return Object.entries(categoryExpenses).map(([name, value]) => ({
        name,
        value: parseFloat(value.toFixed(2)),
      }));
    }
    return null;
  }, [financialItems]);

  const toggleDetails = (itemId) => {
    // Renamed from toggleItemDetails
    setSelectedItemId(selectedItemId === itemId ? null : itemId); // Updated to use selectedItemId
  };

  const getSentimentIcon = (sentiment) => {
    // New helper function
    if (sentiment === "positive") return "👍";
    if (sentiment === "negative") return "👎";
    return "😐"; // Neutral or not set
  };

  if (isLoading) {
    return (
      <div className="container">
        <p style={{ textAlign: "center", fontSize: "1.2em" }}>
          Loading dashboard for{" "}
          <strong className="email-address">{userEmail}</strong>...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container error-message" style={{ textAlign: "center" }}>
        <p>{error}</p>
        <Link to="/" className="link-button" style={{ marginTop: "15px" }}>
          Try a different email
        </Link>
      </div>
    );
  }

  // Tooltip and Legend text color for Recharts - using a lighter color for better contrast
  const chartTextColor = "#e0e6f1"; // Primary light text
  const gridStrokeColor = "#4a5568"; // A slightly more visible grid/border color than before
  const barFillColor = "#25C7D9"; // Using one of the bright PIE_COLORS for consistency

  return (
    <div className="container dashboard">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "30px",
          paddingBottom: "20px",
          borderBottom: `1px solid ${gridStrokeColor}`, // Use theme color
        }}
      >
        <h1 style={{ fontSize: "2rem", margin: 0 }}>
          {" "}
          {/* Removed color, inherits from h1 style */}
          Intelligence Hub for:{" "}
          <span style={{ fontWeight: "normal", color: "#e0e6f1" }}>
            jvirdi2895@gmail.com
          </span>
        </h1>
        <Link to="/" className="link-button">
          Change Email
        </Link>
      </div>

      {upcomingRenewals.length > 0 && (
        <div
          className="upcoming-renewals" // Style this class in index.css if more customization needed
          style={{
            backgroundColor: "rgba(236, 201, 75, 0.1)", // Warning/Yellow with opacity
            padding: "20px 25px",
            borderRadius: "8px",
            marginBottom: "35px",
            border: `1px solid rgba(236, 201, 75, 0.3)`,
          }}
        >
          <h2
            style={{
              fontSize: "1.4rem",
              color: "#ecc94b", // Warning Yellow
              marginBottom: "15px",
              borderBottom: "none", // Remove default h2 border for this section
              paddingBottom: 0,
              marginTop: 0,
            }}
          >
            🚨 Upcoming Renewals (Next 30 Days)
          </h2>
          <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {upcomingRenewals.map((item) => (
              <li
                key={`renewal-${item.id}`}
                style={{
                  marginBottom: "10px",
                  fontSize: "1rem",
                  color: "#e0e6f1", // Primary text
                }}
              >
                <strong style={{ color: "#63b3ed" }}>{item.vendor_name}</strong>{" "}
                ( {/* Accent color for vendor */}
                {item.product_name || "Subscription"}) - Renews on{" "}
                <strong style={{ color: "#f56565" }}>
                  {" "}
                  {/* Error/Red for date */}
                  {new Date(item.next_renewal_date_calc).toLocaleDateString()}
                </strong>{" "}
                for {item.currency_display || "$"}
                {item.amount_display}
                {item.original_currency &&
                  item.original_currency !== item.currency_display && (
                    <small
                      style={{
                        display: "inline",
                        color: "#a8b2c1", // Secondary text
                        fontSize: "0.9em",
                        marginLeft: "8px",
                      }}
                    >
                      (Original: {item.original_amount} {item.original_currency}
                      )
                    </small>
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(monthlyExpenseData || categoryExpenseData) && (
        <div className="charts-section" style={{ marginBottom: "40px" }}>
          <h2 style={{ textAlign: "center" }}>
            {" "}
            {/* Centered h2 for Spending Overview */}
            Spending Overview
          </h2>
          <div
            style={{
              display: "flex",
              justifyContent: "space-around",
              flexWrap: "wrap",
              gap: "30px", // Increased gap
            }}
          >
            {monthlyExpenseData && (
              <div
                style={{
                  flex: "1 1 400px",
                  minWidth: "300px",
                  background: "#252c38", // Darker card background
                  padding: "30px", // Increased padding
                  borderRadius: "10px",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.25)",
                  border: `1px solid ${gridStrokeColor}`,
                }}
              >
                <h3
                  style={{
                    textAlign: "center",
                    marginBottom: "25px",
                    color: "#c2d0e3",
                  }}
                >
                  Monthly Spending
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={monthlyExpenseData}
                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={gridStrokeColor}
                    />
                    <XAxis dataKey="name" tick={{ fill: chartTextColor }} />
                    <YAxis tick={{ fill: chartTextColor }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#2c3440",
                        border: `1px solid ${gridStrokeColor}`,
                        borderRadius: "6px",
                      }}
                      labelStyle={{ color: "#ffffff", fontWeight: "bold" }} // Bright white for tooltip label
                      itemStyle={{ color: chartTextColor }}
                      cursor={{ fill: "rgba(37, 199, 217, 0.1)" }}
                      formatter={(value) => `$${value.toFixed(2)}`}
                    />
                    <Legend
                      wrapperStyle={{
                        color: chartTextColor,
                        paddingTop: "10px",
                      }}
                    />
                    <Bar dataKey="Spending" fill={barFillColor} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {categoryExpenseData && (
              <div
                style={{
                  flex: "1 1 400px",
                  minWidth: "300px",
                  background: "#252c38",
                  padding: "30px",
                  borderRadius: "10px",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.25)",
                  border: `1px solid ${gridStrokeColor}`,
                }}
              >
                <h3
                  style={{
                    textAlign: "center",
                    marginBottom: "25px",
                    color: "#c2d0e3",
                  }}
                >
                  Spending by Category
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={categoryExpenseData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      outerRadius={100}
                      fill="#8884d8" // Default fill, overridden by Cells
                      dataKey="value"
                      stroke={gridStrokeColor} // Border for pie segments
                    >
                      {categoryExpenseData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#2c3440",
                        border: `1px solid ${gridStrokeColor}`,
                        borderRadius: "6px",
                      }}
                      labelStyle={{ color: "#ffffff", fontWeight: "bold" }} // Bright white for tooltip label
                      itemStyle={{ color: chartTextColor }}
                      formatter={(value) => `$${value.toFixed(2)}`}
                    />
                    <Legend
                      wrapperStyle={{
                        color: chartTextColor,
                        paddingTop: "10px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      <h2 style={{ textAlign: "center" }}>
        {" "}
        {/* Centered h2 for Financial Items */}
        Your Financial Items & Context
      </h2>
      {financialItems.length === 0 ? (
        <p
          style={{
            fontStyle: "italic",
            color: "#a8b2c1",
            textAlign: "center",
            marginTop: "20px",
          }}
        >
          No financial items found for this email address yet. Make sure you've
          forwarded some emails to the hub address!
        </p>
      ) : (
        <ul className="item-list">
          {financialItems.map((item) => (
            <li key={item.id} className="financial-item">
              <div
                onClick={() => toggleDetails(item.id)}
                style={{
                  cursor: "pointer",
                  paddingBottom: "10px",
                  borderBottom:
                    selectedItemId === item.id
                      ? `1px solid ${gridStrokeColor}`
                      : "none",
                  marginBottom: selectedItemId === item.id ? "15px" : "0px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h3>
                    {item.vendor_name || "Unknown Vendor"}
                    {item.product_name &&
                    item.product_name !==
                      `Subscription - ${item.billing_cycle}` &&
                    item.product_name !== "Purchase" &&
                    item.product_name !== item.vendor_name
                      ? ` - ${item.product_name}`
                      : ""}
                  </h3>
                  <span>
                    {(() => {
                      let currencyPrefix = item.currency_display;
                      const numericAmount = parseFloat(item.amount_display);
                      const amountValue = !isNaN(numericAmount)
                        ? numericAmount
                        : "0";
                      if (
                        !item.currency_display ||
                        item.currency_display === "$"
                      ) {
                        currencyPrefix = "USD";
                      }
                      const displayCurrency = currencyPrefix || "";
                      return `${displayCurrency} ${amountValue}`;
                    })()}
                  </span>
                </div>
                {item.original_currency &&
                  item.original_currency !== item.currency_display && (
                    <p
                      style={{
                        margin: "5px 0 0",
                        color: "#a8b2c1", // Secondary text
                        fontSize: "0.85em",
                      }}
                    >
                      Original:{" "}
                      {(() => {
                        const numericOriginalAmount = parseFloat(
                          item.original_amount
                        );
                        const originalAmountValue = !isNaN(
                          numericOriginalAmount
                        )
                          ? numericOriginalAmount
                          : "0";
                        let originalCurrencyText = item.original_currency;
                        if (
                          !item.original_currency ||
                          item.original_currency === "$"
                        ) {
                          originalCurrencyText = "USD";
                        }
                        const displayOriginalCurrency =
                          originalCurrencyText || "";
                        return `${originalAmountValue} ${displayOriginalCurrency}`;
                      })()}
                    </p>
                  )}
                <p
                  style={{
                    margin: "10px 0 8px", // Adjusted margin
                    color: "#a8b2c1", // Secondary text
                    fontSize: "0.9rem",
                  }}
                >
                  <strong>Date:</strong>{" "}
                  {item.purchase_date
                    ? new Date(item.purchase_date).toLocaleDateString()
                    : "N/A"}
                  {item.billing_cycle && (
                    <span style={{ marginLeft: "15px" }}>
                      <strong>Cycle:</strong> {item.billing_cycle}
                    </span>
                  )}
                </p>
                <span
                  style={{
                    fontSize: "0.9em",
                    color: selectedItemId === item.id ? "#f56565" : "#63b3ed", // Error/Red : Accent
                    fontWeight: "500",
                    display: "inline-block",
                    marginTop: "8px",
                    padding: "5px 10px",
                    borderRadius: "5px",
                    backgroundColor:
                      selectedItemId === item.id
                        ? "rgba(245, 101, 101, 0.15)" // Red with opacity
                        : "rgba(99, 179, 237, 0.15)", // Accent with opacity
                    transition: "background-color 0.2s ease, color 0.2s ease",
                  }}
                >
                  {selectedItemId === item.id ? "Hide Details" : "Show Details"}
                </span>
              </div>

              {selectedItemId === item.id && (
                <div
                  className="item-details-expanded" // Keep class for potential specific targeting
                  style={{
                    marginTop: "20px",
                    paddingTop: "15px",
                    borderTop: `1px solid ${gridStrokeColor}`,
                  }}
                >
                  <h4
                    style={{
                      fontSize: "1.1rem",
                      color: "#c2d0e3",
                      marginBottom: "12px",
                    }}
                  >
                    Additional Details:
                  </h4>
                  <dl
                    style={{
                      fontSize: "0.95rem",
                      color: "#a8b2c1",
                      paddingLeft: "10px",
                    }}
                  >
                    <div style={{ marginBottom: "8px" }}>
                      <dt
                        style={{
                          fontWeight: "bold",
                          display: "inline",
                          color: "#e0e6f1",
                        }}
                      >
                        Item ID (Internal):
                      </dt>{" "}
                      <dd style={{ display: "inline", marginLeft: "5px" }}>
                        {item.id}
                      </dd>
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <dt
                        style={{
                          fontWeight: "bold",
                          display: "inline",
                          color: "#e0e6f1",
                        }}
                      >
                        Category:
                      </dt>{" "}
                      <dd style={{ display: "inline", marginLeft: "5px" }}>
                        {item.category || "N/A"}
                      </dd>
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <dt
                        style={{
                          fontWeight: "bold",
                          display: "inline",
                          color: "#e0e6f1",
                        }}
                      >
                        Purchase Date:
                      </dt>{" "}
                      <dd style={{ display: "inline", marginLeft: "5px" }}>
                        {item.purchase_date
                          ? new Date(item.purchase_date).toLocaleDateString()
                          : "N/A"}
                      </dd>
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <dt
                        style={{
                          fontWeight: "bold",
                          display: "inline",
                          color: "#e0e6f1",
                        }}
                      >
                        Billing Cycle:
                      </dt>{" "}
                      <dd style={{ display: "inline", marginLeft: "5px" }}>
                        {item.billing_cycle || "N/A"}
                      </dd>
                    </div>
                    {item.payment_method_details && (
                      <div style={{ marginBottom: "8px" }}>
                        <dt
                          style={{
                            fontWeight: "bold",
                            display: "inline",
                            color: "#e0e6f1",
                          }}
                        >
                          Payment Method:
                        </dt>{" "}
                        <dd style={{ display: "inline", marginLeft: "5px" }}>
                          {item.payment_method_details}
                        </dd>
                      </div>
                    )}
                    {item.transaction_id && (
                      <div style={{ marginBottom: "8px" }}>
                        <dt
                          style={{
                            fontWeight: "bold",
                            display: "inline",
                            color: "#e0e6f1",
                          }}
                        >
                          Transaction ID:
                        </dt>{" "}
                        <dd style={{ display: "inline", marginLeft: "5px" }}>
                          {item.transaction_id}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <p
                    style={{
                      fontSize: "0.95rem",
                      color: "#a8b2c1",
                      marginTop: "20px",
                    }}
                  >
                    <strong>Original Email Subject:</strong>{" "}
                    <em style={{ color: "#c2d0e3" }}>
                      {item.raw_email_subject || "N/A"}
                    </em>
                  </p>

                  {item.billing_cycle &&
                    item.billing_cycle !== "one-time" &&
                    item.purchase_date && (
                      <a
                        href={`${API_URL}/api/data/${encodeURIComponent(
                          userEmail
                        )}/financial-items/${item.id}/ics`}
                        className="link-button ics-button" // Use link-button for base style
                        download
                        style={{
                          display: "inline-block",
                          margin: "15px 0",
                          padding: "10px 15px",
                          backgroundColor: "#48bb78", // Green for calendar button
                          color: "#1a1f2c", // Dark text on green button
                          textDecoration: "none",
                          borderRadius: "5px",
                          fontSize: "0.9em",
                        }}
                      >
                        🗓️ Add Renewal to Calendar
                      </a>
                    )}

                  {item.context_highlights &&
                    item.context_highlights.length > 0 && (
                      // context-section class handles styling from index.css
                      <div className="context-section">
                        <h4>🧠 Contextual Insights from Emails:</h4>
                        <ul className="highlight-list">
                          {item.context_highlights.map((highlight) => (
                            <li
                              key={highlight.id}
                              className={`context-highlight sentiment-${
                                highlight.sentiment || "neutral"
                              }`}
                            >
                              <span
                                className="sentiment-icon"
                                style={{
                                  marginRight: "10px",
                                  fontSize: "1.2rem",
                                }}
                              >
                                {getSentimentIcon(highlight.sentiment)}
                              </span>
                              <div style={{ flex: 1 }}>
                                <p
                                  style={{
                                    margin: "0 0 5px 0",
                                    color: "#e0e6f1",
                                  }}
                                >
                                  {" "}
                                  {/* Primary text for highlight text */}
                                  {highlight.highlight_text}
                                </p>
                                {highlight.source_email_subject &&
                                  highlight.source_email_subject !==
                                    item.raw_email_subject && (
                                    // small tag within context-highlight is styled by index.css
                                    <small>
                                      <em>
                                        (From discussion:{" "}
                                        {highlight.source_email_subject})
                                      </em>
                                    </small>
                                  )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {(!item.context_highlights ||
                    item.context_highlights.length === 0) && (
                    <p
                      className="no-context"
                      style={{
                        marginTop: "20px",
                        fontStyle: "italic",
                        color: "#718096", // Muted gray for no context
                        fontSize: "0.9rem",
                        textAlign: "center",
                      }}
                    >
                      <small>
                        <em>
                          No specific context highlights automatically linked
                          for this item yet.
                        </em>
                      </small>
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default DashboardPage;
