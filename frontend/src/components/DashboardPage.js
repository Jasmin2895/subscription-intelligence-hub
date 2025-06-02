// frontend/src/components/DashboardPage.js
import React, { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip, // Renamed to avoid conflict if any other Tooltip is imported
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const API_URL = process.env.REACT_APP_API_URL;

console.log("API_URL", API_URL);

const PIE_COLORS = [
  "#00A9E0", // Vivid Blue
  "#FF6F61", // Living Coral/Bright Salmon
  "#6A0DAD", // Deep Purple
  "#3DDC97", // Bright Mint Green
  "#FFD700", // Gold
  "#40E0D0", // Turquoise
  "#FF7F50", // Coral
  "#9370DB", // Medium Purple
  "#20B2AA", // Light Sea Green
  "#FFC0CB", // Pink
];

// Helper function to calculate next renewal date (can be outside component or in a utils file)
const calculateNextRenewal = (purchaseDateStr, billingCycle) => {
  if (!purchaseDateStr || !billingCycle || billingCycle === "one-time") {
    return null;
  }
  const purchaseDate = new Date(purchaseDateStr);
  const now = new Date();
  let nextRenewal = new Date(
    purchaseDate.getFullYear(),
    purchaseDate.getMonth(),
    purchaseDate.getDate()
  );
  now.setHours(0, 0, 0, 0); // Normalize 'now' for date-only comparison

  if (billingCycle === "monthly") {
    while (nextRenewal < now) {
      nextRenewal.setMonth(nextRenewal.getMonth() + 1);
    }
  } else if (billingCycle === "annually") {
    while (nextRenewal < now) {
      nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
    }
  } else {
    return null; // Or handle other cycles like quarterly
  }
  return nextRenewal;
};

function DashboardPage() {
  const { userEmail } = useParams();
  const [financialItems, setFinancialItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedItemId, setSelectedItemId] = useState(null);
  // We still calculate upcomingRenewals to know which items get a tag.
  const [upcomingRenewalsMap, setUpcomingRenewalsMap] = useState({});

  useEffect(() => {
    if (userEmail) {
      setIsLoading(true);
      setError("");
      setFinancialItems([]);
      setUpcomingRenewalsMap({});
      axios
        .get(
          `${API_URL}/api/data/${encodeURIComponent(userEmail)}/financial-items`
        )
        .then((response) => {
          const items = response.data;
          setFinancialItems(items);

          // Prepare a map for easy lookup of upcoming renewals
          const renewalsMap = {};
          const now = new Date();
          const thirtyDaysFromNow = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
          );
          now.setHours(0, 0, 0, 0);

          items.forEach((item) => {
            const nextRenewalDate = calculateNextRenewal(
              item.purchase_date,
              item.billing_cycle
            );
            if (
              nextRenewalDate &&
              nextRenewalDate >= now &&
              nextRenewalDate <= thirtyDaysFromNow
            ) {
              renewalsMap[item.id] = nextRenewalDate
                .toISOString()
                .split("T")[0];
            }
          });
          setUpcomingRenewalsMap(renewalsMap);

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
              `Failed to fetch data for ${userEmail}. Ensure backend is running & you've forwarded emails.`
            );
          }
          setIsLoading(false);
        });
    }
  }, [userEmail]);

  const monthlyExpenseData = useMemo(() => {
    // ... (your existing monthlyExpenseData logic - no changes needed here)
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
    // ... (your existing categoryExpenseData logic - no changes needed here)
    if (!financialItems || financialItems.length === 0) return null;
    const categoryExpenses = {};
    financialItems.forEach((item) => {
      if (item.amount_display != null) {
        let determinedCategory = item.category || item.category || "Unknown"; // Prioritize category field
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
    setSelectedItemId(selectedItemId === itemId ? null : itemId);
  };

  const getSentimentIcon = (sentiment) => {
    if (sentiment === "positive") return "👍";
    if (sentiment === "negative") return "👎";
    return "😐";
  };

  if (isLoading) {
    /* ... (no change) ... */
  }
  if (error) {
    /* ... (no change) ... */
  }

  const chartTextColor = "#e0e6f1";
  const gridStrokeColor = "#4a5568";
  const barFillColor = "#25C7D9";

  return (
    <div className="container dashboard">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "30px",
          paddingBottom: "20px",
          borderBottom: `1px solid ${gridStrokeColor}`,
        }}
      >
        <h1 style={{ fontSize: "2rem", margin: 0 }}>
          Intelligence Hub for:{" "}
          <span style={{ fontWeight: "normal", color: "#e0e6f1" }}>
            {userEmail} {/* Display dynamic userEmail */}
          </span>
        </h1>
        <Link to="/" className="link-button">
          Change Email
        </Link>
      </div>

      {/* REMOVED the upcoming renewals banner from here */}

      {(monthlyExpenseData || categoryExpenseData) && (
        // ... (your existing charts section - no changes needed here)
        <div className="charts-section" style={{ marginBottom: "40px" }}>
          <h2 style={{ textAlign: "center" }}> Spending Overview </h2>
          <div
            style={{
              display: "flex",
              justifyContent: "space-around",
              flexWrap: "wrap",
              gap: "30px",
            }}
          >
            {monthlyExpenseData && (
              <div className="chart-card">
                <h3 className="chart-title">Monthly Spending</h3>
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
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "#2c3440",
                        border: `1px solid ${gridStrokeColor}`,
                        borderRadius: "6px",
                      }}
                      labelStyle={{ color: "#ffffff", fontWeight: "bold" }}
                      itemStyle={{ color: chartTextColor }}
                      cursor={{ fill: "rgba(37, 199, 217, 0.1)" }}
                      formatter={(value) => `$${parseFloat(value).toFixed(2)}`}
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
              <div className="chart-card">
                <h3 className="chart-title">Spending by Category/Vendor</h3>
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
                      fill="#8884d8"
                      dataKey="value"
                      stroke={gridStrokeColor}
                    >
                      {categoryExpenseData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "#2c3440",
                        border: `1px solid ${gridStrokeColor}`,
                        borderRadius: "6px",
                      }}
                      labelStyle={{ color: "#ffffff", fontWeight: "bold" }}
                      itemStyle={{ color: chartTextColor }}
                      formatter={(value) => `$${parseFloat(value).toFixed(2)}`}
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

      <h2 style={{ textAlign: "center" }}>Your Financial Items & Context</h2>
      {financialItems.length === 0 ? (
        /* ... (no change to "no items" message) ... */
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
          {financialItems.map((item) => {
            // Check if this item is an upcoming renewal
            const renewalDateForThisItem = upcomingRenewalsMap[item.id];

            return (
              <li key={item.id} className="financial-item">
                <div
                  className="item-summary" // Added class for styling consistency
                  onClick={() => toggleDetails(item.id)}
                >
                  <div className="item-header">
                    <h3>
                      {item.category || "Unknown Category"}
                      {item.product_name &&
                      item.product_name !== item.category && // Simplified condition
                      item.product_name !==
                        `Subscription - ${item.billing_cycle}` &&
                      item.product_name !== "Purchase"
                        ? ` - ${item.product_name}`
                        : ""}
                    </h3>
                    <span className="item-price">
                      {" "}
                      {/* Added class for price */}
                      {item.currency_display || "$"}
                      {item.amount_display?.toFixed(2) || "N/A"}
                    </span>
                  </div>
                  <div className="item-meta">
                    <p>
                      <strong>Date:</strong>{" "}
                      {item.purchase_date
                        ? new Date(item.purchase_date).toLocaleDateString()
                        : "N/A"}
                    </p>
                    {item.billing_cycle && (
                      <p className="cycle">
                        <strong>Cycle:</strong> {item.billing_cycle}
                      </p>
                    )}
                    {item.original_currency &&
                      item.original_currency !== item.currency_display &&
                      item.original_amount != null && (
                        <p className="original-amount">
                          (Original: {item.original_amount?.toFixed(2)}{" "}
                          {item.original_currency})
                        </p>
                      )}
                  </div>
                  {/* --- NEW RENEWAL TAG --- */}
                  {renewalDateForThisItem && (
                    <div className="renewal-tag-container">
                      <span className="renewal-tag">
                        🚨 Renews:{" "}
                        {new Date(renewalDateForThisItem).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {/* --- END NEW RENEWAL TAG --- */}
                  <span className="details-toggle">
                    {selectedItemId === item.id
                      ? "Hide Details"
                      : "Show Details"}
                  </span>
                </div>

                {selectedItemId === item.id && (
                  <div className="item-details-expanded">
                    {/* ... (your existing item-details-expanded JSX for category, subject, ICS button, context highlights etc. - NO CHANGES NEEDED HERE) ... */}
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
                        </dd>{" "}
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
                        </dd>{" "}
                      </div>
                      {item.billing_cycle &&
                        item.billing_cycle !== "one-time" &&
                        item.purchase_date && (
                          <div style={{ marginTop: "15px" }}>
                            <a
                              href={`${API_URL}/api/data/${encodeURIComponent(
                                userEmail
                              )}/financial-items/${item.id}/ics`}
                              className="link-button ics-button"
                              download
                            >
                              🗓️ Add Renewal to Calendar
                            </a>
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
                    {item.context_highlights &&
                      item.context_highlights.length > 0 && (
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
                                    {highlight.highlight_text}
                                  </p>
                                  {highlight.source_email_subject &&
                                    highlight.source_email_subject !==
                                      item.raw_email_subject && (
                                      <small className="highlight-source">
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
                          color: "#718096",
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
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default DashboardPage;
