// backend/server.js
require("dotenv").config(); // Load .env file first
const express = require("express");
const cors = require("cors");
const db = require("./database");
const { extractContextHighlights } = require("./utils/contextExtractor");
const { getStructuredDataFromEmail } = require("./services/openAiService"); // NEW
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const ics = require("ics");

// --- Configuration from .env or defaults ---
const POSTMARK_INBOUND_DOMAIN =
  process.env.POSTMARK_INBOUND_DOMAIN ||
  "YOUR_UNIQUE_ID.inbound.postmarkapp.com";
const APP_RECEIVING_EMAIL_PREFIX =
  process.env.APP_RECEIVING_EMAIL_PREFIX || "hub";
const FULL_APP_RECEIVING_EMAIL = `${APP_RECEIVING_EMAIL_PREFIX}@${POSTMARK_INBOUND_DOMAIN}`;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

const INR_TO_USD_RATE = parseFloat(process.env.INR_TO_USD_RATE) || 0.012;
const EUR_TO_USD_RATE = parseFloat(process.env.EUR_TO_USD_RATE) || 1.08;
const GBP_TO_USD_RATE = parseFloat(process.env.GBP_TO_USD_RATE) || 1.27;

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

console.log(
  `SERVER_LOG: App configured to receive emails at: ${FULL_APP_RECEIVING_EMAIL}`
);
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "SERVER_WARN: OPENAI_API_KEY not found in .env file. Financial email parsing will likely fail."
  );
}
if (!SLACK_WEBHOOK_URL) {
  console.warn(
    "SERVER_WARN: SLACK_WEBHOOK_URL not found in .env or empty. Slack notifications will be skipped."
  );
}

// --- Slack Notification (using fetch as per your original code) ---
async function sendSlackNotification(message) {
  console.log("SLACK_LOG: Attempting to send notification...");
  if (!SLACK_WEBHOOK_URL) {
    console.log("SLACK_LOG: Slack Webhook URL not configured. Skipping.");
    return;
  }
  try {
    const payload = { text: message }; // Simple text message, or use blocks like before
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(
        `SLACK_ERROR: Sending notification: ${response.status} ${response.statusText}`,
        await response.text()
      );
    } else {
      console.log("SLACK_LOG: Notification sent successfully.");
    }
  } catch (error) {
    console.error("SLACK_ERROR: Exception sending notification:", error);
  }
}

// --- Webhook for Postmark ---
app.post("/webhook/email-inbound", async (req, res) => {
  const webhookReceivedTime = Date.now();
  console.log(
    "WEBHOOK_LOG: Received an email at",
    new Date(webhookReceivedTime).toISOString()
  );
  const emailData = req.body; // Postmark sends JSON

  let ownerEmail = null;
  if (
    emailData.FromFull &&
    typeof emailData.FromFull === "object" &&
    emailData.FromFull.Email
  ) {
    // Postmark often sends FromFull as an object not array
    ownerEmail = emailData.FromFull.Email.toLowerCase();
  } else if (
    emailData.FromFull &&
    Array.isArray(emailData.FromFull) &&
    emailData.FromFull.length > 0 &&
    emailData.FromFull[0].Email
  ) {
    ownerEmail = emailData.FromFull[0].Email.toLowerCase();
  } else if (emailData.From) {
    // Fallback to parsing From string
    const match = emailData.From.match(/<([^>]+)>/);
    if (match && match[1]) {
      ownerEmail = match[1].toLowerCase();
    } else if (!emailData.From.includes("<") && emailData.From.includes("@")) {
      ownerEmail = emailData.From.toLowerCase();
    }
  }

  if (!ownerEmail) {
    console.warn(
      "WEBHOOK_WARN: Could not determine sender's (owner) email. Full FromFull:",
      emailData.FromFull,
      "From:",
      emailData.From
    );
    return res.status(200).send("Sender email not determinable.");
  }
  console.log(
    `WEBHOOK_LOG: Processing for owner ${ownerEmail}, Subject: "${emailData.Subject}"`
  );

  let savedFinancialItem = null;
  let allExtractedHighlightsFromThisEmail = [];
  let slackMessageParts = [];

  try {
    // Attempt to parse using OpenAI IF it looks like a financial email
    // Basic keyword check to decide if we should even call OpenAI for financial parsing
    const financialKeywords = [
      "receipt",
      "invoice",
      "payment",
      "bill",
      "order",
      "subscription",
      "charge",
      "confirm",
    ];
    const lowerSubject = (emailData.Subject || "").toLowerCase();
    const lowerTextBody = (emailData.TextBody || "").toLowerCase();
    let isPotentiallyFinancial = financialKeywords.some(
      (kw) => lowerSubject.includes(kw) || lowerTextBody.includes(kw)
    );

    // Add more specific vendor checks to increase confidence
    const commonVendors = [
      "amazon",
      "netflix",
      "spotify",
      "aws",
      "zoom",
      "microsoft",
      "google",
      "apple",
    ];
    if (!isPotentiallyFinancial) {
      isPotentiallyFinancial = commonVendors.some(
        (v) =>
          lowerSubject.includes(v) ||
          (emailData.From && emailData.From.toLowerCase().includes(v))
      );
    }

    if (isPotentiallyFinancial) {
      console.log(
        "WEBHOOK_LOG: Email seems potentially financial. Attempting OpenAI parse."
      );
      const aiParsedData = await getStructuredDataFromEmail(
        emailData.Subject,
        emailData.TextBody
      );

      if (
        aiParsedData &&
        aiParsedData.vendor_name &&
        aiParsedData.price !== null
      ) {
        console.log(
          "WEBHOOK_LOG: OpenAI successfully parsed financial data:",
          aiParsedData.vendor_name,
          aiParsedData.price
        );

        let financialItemData = {
          owner_email: ownerEmail,
          vendor_name: aiParsedData.vendor_name,
          product_name: aiParsedData.product_name,
          original_amount: aiParsedData.price, // OpenAI returns the amount as seen
          original_currency: aiParsedData.original_currency
            ? aiParsedData.currency.toUpperCase()
            : null, // OpenAI returns ISO
          purchase_date: aiParsedData.purchase_date
            ? new Date(aiParsedData.purchase_date).toISOString()
            : new Date(emailData.Date || Date.now()).toISOString(),
          billing_cycle: aiParsedData.billing_cycle,
          category: aiParsedData.category,
          raw_email_subject: emailData.Subject,
          source_email_message_id: emailData.MessageID,
          amount_display: null, // to be calculated (display price in USD)
          currency_display: "USD", // display currency
        };

        // Currency Conversion to USD for display_amount
        if (financialItemData.original_currency === "INR") {
          financialItemData.amount_display = parseFloat(
            (financialItemData.original_amount * INR_TO_USD_RATE).toFixed(2)
          );
        } else if (financialItemData.original_currency === "EUR") {
          financialItemData.amount_display = parseFloat(
            (financialItemData.original_amount * EUR_TO_USD_RATE).toFixed(2)
          );
        } else if (financialItemData.original_currency === "GBP") {
          financialItemData.amount_display = parseFloat(
            (financialItemData.original_amount * GBP_TO_USD_RATE).toFixed(2)
          );
        } else if (financialItemData.original_currency === "USD") {
          financialItemData.amount_display = financialItemData.original_amount;
        } else if (financialItemData.original_amount !== null) {
          // Unrecognized currency, display as is, flag currency
          console.warn(
            `WEBHOOK_WARN: Unrecognized original currency '${financialItemData.original_currency}'. Displaying original amount, marking currency as original.`
          );
          financialItemData.amount_display = financialItemData.original_amount;
          financialItemData.currency_display =
            financialItemData.original_currency || "N/A"; // Keep original if unknown
        } else {
          financialItemData.amount_display = null; // If original amount is null
          financialItemData.currency_display = null;
        }

        try {
          savedFinancialItem = await db.addFinancialItem(financialItemData);
          console.log(
            `WEBHOOK_LOG: Financial Item (AI parsed) saved for ${ownerEmail}. ID: ${savedFinancialItem.id}`
          );
          slackMessageParts.push(
            `🛍️ AI parsed: ${savedFinancialItem.vendor_name} (${
              savedFinancialItem.currency_display
            }${savedFinancialItem.amount_display?.toFixed(2)})`
          );
        } catch (dbErr) {
          if (
            dbErr.message &&
            dbErr.message.includes("UNIQUE constraint failed")
          ) {
            console.log(
              `WEBHOOK_LOG: Financial Item (AI parsed) from MessageID ${financialItemData.source_email_message_id} already exists. Fetching.`
            );
            const items = await db.getFinancialItemsByOwner(ownerEmail);
            savedFinancialItem = items.find(
              (it) =>
                it.source_email_message_id ===
                financialItemData.source_email_message_id
            );
          } else {
            console.error(
              "WEBHOOK_ERROR: DB Error saving AI parsed financial item:",
              dbErr
            );
            throw dbErr;
          }
        }
      } else {
        console.log(
          "WEBHOOK_LOG: OpenAI did not return sufficient financial data, or email not deemed financial by initial check."
        );
      }
    } else {
      console.log(
        "WEBHOOK_LOG: Email not identified as potentially financial. Skipping OpenAI financial parse."
      );
    }

    // Always try to extract context highlights
    if (emailData.TextBody) {
      allExtractedHighlightsFromThisEmail = extractContextHighlights(
        emailData.TextBody,
        ownerEmail,
        emailData.Subject,
        emailData.MessageID,
        savedFinancialItem.id,
        savedFinancialItem.product_name
      );
    }

    if (allExtractedHighlightsFromThisEmail.length > 0) {
      console.log(
        `WEBHOOK_LOG: Extracted ${allExtractedHighlightsFromThisEmail.length} Context Highlight(s) for ${ownerEmail}.`
      );
      let linkedHighlightsCount = 0;
      for (let highlight of allExtractedHighlightsFromThisEmail) {
        let itemToLinkTo = savedFinancialItem;
        if (!itemToLinkTo && highlight.product_keyword) {
          itemToLinkTo = await db.findFinancialItemByKeywordAndOwner(
            highlight.product_keyword,
            ownerEmail
          );
        }

        if (
          itemToLinkTo &&
          highlight.product_keyword &&
          (itemToLinkTo.vendor_name
            ?.toLowerCase()
            .includes(highlight.product_keyword.toLowerCase()) ||
            itemToLinkTo.product_name
              ?.toLowerCase()
              .includes(highlight.product_keyword.toLowerCase()))
        ) {
          highlight.financial_item_id = itemToLinkTo.id;
          linkedHighlightsCount++;
          console.log(
            `WEBHOOK_LOG: Auto-linking highlight about '${highlight.product_keyword}' to financial item ID ${itemToLinkTo.id}`
          );
        }
        try {
          await db.addContextHighlight(highlight);
        } catch (dbErr) {
          /* ... */
        }
      }
      if (linkedHighlightsCount > 0) {
        slackMessageParts.push(
          `💡 Found ${linkedHighlightsCount} relevant context point(s).`
        );
      } else if (allExtractedHighlightsFromThisEmail.length > 0) {
        slackMessageParts.push(
          `💬 Processed ${allExtractedHighlightsFromThisEmail.length} discussion point(s).`
        );
      }
    }

    if (slackMessageParts.length > 0) {
      await sendSlackNotification(
        `Update for *${ownerEmail}* (Re: ${
          emailData.Subject
        }):\n- ${slackMessageParts.join(
          "\n- "
        )}\n<http://localhost:3000/dashboard/${encodeURIComponent(
          ownerEmail
        )}|View Dashboard>`
      );
    }

    console.log(
      `WEBHOOK_LOG: Processing for ${ownerEmail} completed in ${
        Date.now() - webhookReceivedTime
      }ms.`
    );
    res.status(200).send("Email processed by Hub.");
  } catch (error) {
    console.error(
      `WEBHOOK_ERROR: Unhandled error processing email for ${ownerEmail} (Subject: ${emailData.Subject}):`,
      error
    );
    await sendSlackNotification(
      `Webhook ERROR for ${ownerEmail} (Re: ${emailData.Subject}): ${error.message}`
    );
    res.status(500).send("Internal Server Error processing email.");
  }
});

// API Endpoint for Frontend - (Ensure this correctly joins financial items with their context highlights, including sentiment)
app.get("/api/data/:ownerEmail/financial-items", async (req, res) => {
  const ownerEmailParam = req.params.ownerEmail
    ? req.params.ownerEmail.toLowerCase()
    : null;
  if (!ownerEmailParam) {
    return res
      .status(400)
      .json({ error: "Owner email parameter is required." });
  }
  console.log(`API_LOG: Fetching data for owner: ${ownerEmailParam}`);
  try {
    const items = await db.getFinancialItemsByOwner(ownerEmailParam);
    const itemsWithContext = [];

    for (const item of items) {
      let allHighlightsForItem = await db.getContextHighlightsForItem(item.id);

      const productKeywordForItem = item.vendor_name || item.product_name;
      if (productKeywordForItem) {
        const keywordHighlights =
          await db.getContextHighlightsByProductKeywordAndOwner(
            productKeywordForItem,
            ownerEmailParam
          );
        keywordHighlights.forEach((kh) => {
          if (!allHighlightsForItem.find((ah) => ah.id === kh.id)) {
            allHighlightsForItem.push(kh);
          }
        });
      }
      // Ensure 'price' here is the display price (USD) and 'currency' is 'USD'
      // The DB stores original_amount, original_currency, price (USD), currency (USD)
      itemsWithContext.push({
        ...item,
        price: item.price, // This should be the USD converted price from DB
        currency: item.currency, // This should be 'USD' from DB
        context_highlights: allHighlightsForItem,
      });
    }
    res.json(itemsWithContext);
  } catch (error) {
    console.error(
      `API_ERROR: Error fetching financial items for ${ownerEmailParam}:`,
      error
    );
    res.status(500).json({ error: "Failed to fetch financial items" });
  }
});

app.get(
  "/api/data/:ownerEmail/financial-items/:itemId/ics",
  async (req, res) => {
    const { ownerEmail, itemId } = req.params;
    const ownerEmailLower = ownerEmail ? ownerEmail.toLowerCase() : null;

    console.log(`ICS_REQUEST: For owner ${ownerEmailLower}, item ID ${itemId}`);

    if (!ownerEmailLower || !itemId) {
      return res
        .status(400)
        .json({ error: "Owner email and Item ID are required." });
    }

    try {
      // You'd need a database function to get a single item by ID and owner
      // For simplicity, let's adapt using getFinancialItemsByOwner and then filtering.
      // In a real app, db.getFinancialItemByIdAndOwner(itemId, ownerEmailLower) would be better.
      const items = await db.getFinancialItemsByOwner(ownerEmailLower);
      const item = items.find((i) => i.id === itemId);

      if (!item) {
        console.warn(
          `ICS_WARN: Financial item ${itemId} not found for owner ${ownerEmailLower}`
        );
        return res.status(404).send("Financial item not found.");
      }

      // Check if the item is suitable for a renewal reminder (has date and recurring cycle)
      if (
        !item.purchase_date ||
        !item.billing_cycle ||
        item.billing_cycle === "one-time"
      ) {
        console.warn(
          `ICS_WARN: Item ${itemId} is not a recurring subscription with a date.`
        );
        return res
          .status(400)
          .send(
            "Item is not a recurring subscription or has no valid date for renewal."
          );
      }

      let nextRenewalDate;
      const purchaseDate = new Date(item.purchase_date);
      const now = new Date();
      now.setHours(0, 0, 0, 0); // Normalize 'now' to the start of the day for comparisons

      if (item.billing_cycle.toLowerCase() === "monthly") {
        nextRenewalDate = new Date(
          purchaseDate.getFullYear(),
          purchaseDate.getMonth(),
          purchaseDate.getDate()
        );
        while (nextRenewalDate < now) {
          nextRenewalDate.setMonth(nextRenewalDate.getMonth() + 1);
        }
      } else if (item.billing_cycle.toLowerCase() === "annually") {
        nextRenewalDate = new Date(
          purchaseDate.getFullYear(),
          purchaseDate.getMonth(),
          purchaseDate.getDate()
        );
        while (nextRenewalDate < now) {
          nextRenewalDate.setFullYear(nextRenewalDate.getFullYear() + 1);
        }
      } else {
        console.warn(
          `ICS_WARN: Item ${itemId} has unsupported billing cycle: ${item.billing_cycle}`
        );
        return res
          .status(400)
          .send("Unsupported billing cycle for calendar event.");
      }

      // Construct the event for the .ics file
      const event = {
        title: `Renewal: ${item.vendor_name || "Unknown Vendor"} - ${
          item.product_name || "Subscription"
        }`,
        description:
          `Reminder to review your subscription for ${
            item.vendor_name || "Unknown Vendor"
          }. ` +
          `Approx. Cost: ${item.currency_display || "$"}${
            item.amount_display?.toFixed(2) || "N/A"
          }. ` + // Using amount_display
          `Managed by Your Financial Hub.`,
        start: [
          nextRenewalDate.getFullYear(),
          nextRenewalDate.getMonth() + 1,
          nextRenewalDate.getDate(),
        ], // Month is 1-indexed for ics
        duration: { hours: 1 }, // Or { days: 1 } for an all-day event
        status: "CONFIRMED",
        organizer: {
          name: "Your Financial Hub",
          email: ownerEmail,
        }, // Use your app's general email
        attendees: [
          {
            name: "Subscriber",
            email: ownerEmailLower,
            rsvp: false,
            partstat: "NEEDS-ACTION",
            role: "REQ-PARTICIPANT",
          },
        ],
      };

      const { error, value } = ics.createEvent(event);

      if (error) {
        console.error("ICS_ERROR: Generating iCalendar file:", error);
        return res.status(500).send("Error generating iCalendar file.");
      }

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(item.vendor_name || "item").replace(
          /[^a-z0-9]/gi,
          "_"
        )}_renewal.ics"`
      );
      res.send(value);
      console.log(
        `ICS_SUCCESS: Sent .ics file for item ${itemId} for owner ${ownerEmailLower}`
      );
    } catch (err) {
      console.error(
        `ICS_ERROR: API error for owner ${ownerEmailLower}, item ${itemId}:`,
        err
      );
      res
        .status(500)
        .send("Failed to generate iCalendar file due to a server error.");
    }
  }
);

app.get("/", (req, res) =>
  res.send("Brainstormer Hub Backend (OpenAI Parser MVP) is running!")
);
app.listen(PORT, () =>
  console.log(`Backend server running on http://localhost:${PORT}`)
);
