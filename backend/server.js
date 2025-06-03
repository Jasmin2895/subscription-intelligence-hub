// backend/server.js
require("dotenv").config(); // Load .env file first
const express = require("express");
const cors = require("cors");
const db = require("./database");
const { extractContextHighlights } = require("./utils/contextExtractor");
const { getStructuredDataFromEmail } = require("./services/openAiService");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios"); // Keep for Slack if you use it later
const ics = require("ics"); // Keep for calendar export

// --- Configuration from .env or defaults ---
const POSTMARK_INBOUND_DOMAIN =
  process.env.POSTMARK_INBOUND_DOMAIN ||
  "YOUR_UNIQUE_ID.inbound.postmarkapp.com"; // !!! REPLACE THIS !!!
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
if (!SLACK_WEBHOOK_URL && process.env.NODE_ENV !== "test") {
  // Avoid warning during tests if Slack isn't focus
  console.warn(
    "SERVER_WARN: SLACK_WEBHOOK_URL not found in .env or empty. Slack notifications will be skipped."
  );
}

// --- Slack Notification Function ---
async function sendSlackNotification(message) {
  // ... (Your existing Slack notification function from Turn 61 or previous)
  // Ensure it's robust and checks if SLACK_WEBHOOK_URL is set.
  // For brevity, not re-pasting the whole function if it's already in your file.
  // Just ensure it uses 'fetch' as per your version or 'axios' if you prefer.
  // The version from Turn 61 using fetch is:
  console.log("SLACK_LOG: Attempting to send notification...");
  if (!SLACK_WEBHOOK_URL) {
    console.log(
      "SLACK_LOG: Slack Webhook URL not configured or empty. Skipping notification."
    );
    return;
  }
  try {
    console.log(`SLACK_LOG: Sending payload to Slack: ${message}`); // Log the simple text message
    const payload = { text: message }; // For simple text messages
    // If using blocks, construct the blocks array and send that as JSON.stringify({ blocks: [...] })
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
    console.error("SLACK_ERROR: Exception sending Slack notification:", error);
  }
}

// --- Webhook for Postmark ---
app.post("/webhook/email-inbound", async (req, res) => {
  const webhookReceivedTime = Date.now();
  console.log(
    "WEBHOOK_LOG: Received an email at",
    new Date(webhookReceivedTime).toISOString()
  );
  const emailData = req.body;

  let ownerEmail = null;
  if (
    emailData.FromFull &&
    typeof emailData.FromFull === "object" &&
    emailData.FromFull.Email
  ) {
    ownerEmail = emailData.FromFull.Email.toLowerCase();
  } else if (
    emailData.FromFull &&
    Array.isArray(emailData.FromFull) &&
    emailData.FromFull.length > 0 &&
    emailData.FromFull[0].Email
  ) {
    ownerEmail = emailData.FromFull[0].Email.toLowerCase();
  } else if (emailData.From) {
    const match = emailData.From.match(/<([^>]+)>/);
    if (match && match[1]) {
      ownerEmail = match[1].toLowerCase();
    } else if (!emailData.From.includes("<") && emailData.From.includes("@")) {
      ownerEmail = emailData.From.toLowerCase();
    }
  }

  if (!ownerEmail) {
    console.warn("WEBHOOK_WARN: Could not determine sender's (owner) email.");
    return res.status(200).send("Sender email not determinable.");
  }
  console.log(
    `WEBHOOK_LOG: Processing for owner ${ownerEmail}, Subject: "${emailData.Subject}"`
  );

  let savedFinancialItem = null;
  let allExtractedHighlightsFromThisEmail = [];
  let slackMessageParts = [];

  try {
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

    const commonVendors = [
      "amazon",
      "netflix",
      "spotify",
      "aws",
      "zoom",
      "microsoft",
      "google",
      "apple",
    ]; // From your constants.js perhaps
    if (!isPotentiallyFinancial && emailData.From) {
      // Check sender if keywords not obvious
      isPotentiallyFinancial = commonVendors.some(
        (v) =>
          emailData.From.toLowerCase().includes(v) &&
          (lowerSubject.includes(v) || lowerTextBody.includes(v))
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

      // Check if aiParsedData is not null and has essential fields before proceeding
      if (
        aiParsedData &&
        aiParsedData.vendor_name &&
        aiParsedData.original_amount !== null
      ) {
        console.log(
          "WEBHOOK_LOG: OpenAI successfully parsed: Vendor: '%s', Amount: %s %s",
          aiParsedData.vendor_name,
          aiParsedData.original_amount,
          aiParsedData.original_currency
        );

        // Date parsing and validation logic from Turn 55's openAiService (should ideally live there or a util)
        let purchaseDateISO = null;
        if (aiParsedData.purchase_date) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(aiParsedData.purchase_date)) {
            const d = new Date(aiParsedData.purchase_date + "T00:00:00Z"); // Interpret as UTC date
            if (!isNaN(d)) purchaseDateISO = d.toISOString();
          } else {
            // Attempt to re-parse if not YYYY-MM-DD
            try {
              const d = new Date(aiParsedData.purchase_date);
              if (!isNaN(d.getTime())) {
                let year = d.getFullYear();
                const inputDateStr = String(aiParsedData.purchase_date);
                if (
                  year < 2000 &&
                  (inputDateStr.match(/\/\d{2}$/) ||
                    inputDateStr.match(/\-\d{2}$/) ||
                    inputDateStr.match(/\.\d{2}$/))
                ) {
                  const twoDigitYear = parseInt(inputDateStr.slice(-2), 10);
                  if (
                    twoDigitYear >= 0 &&
                    twoDigitYear <= (new Date().getFullYear() % 100) + 10
                  )
                    year = 2000 + twoDigitYear;
                  else if (
                    twoDigitYear > (new Date().getFullYear() % 100) + 10 &&
                    twoDigitYear <= 99
                  )
                    year = 1900 + twoDigitYear;
                  d.setFullYear(year);
                }
                purchaseDateISO = d.toISOString();
              }
            } catch (e) {
              console.warn("Date re-parse error", e);
            }
          }
        }
        if (!purchaseDateISO)
          purchaseDateISO = new Date(
            emailData.Date || Date.now()
          ).toISOString();

        let financialItemData = {
          owner_email: ownerEmail,
          vendor_name: aiParsedData.vendor_name,
          product_name: aiParsedData.product_name,
          original_amount: aiParsedData.original_amount,
          original_currency: aiParsedData.original_currency
            ? aiParsedData.original_currency.toUpperCase()
            : null,
          purchase_date: purchaseDateISO,
          billing_cycle: aiParsedData.billing_cycle,
          category: aiParsedData.category || "Other", // **Ensure category is included** and default if null
          raw_email_subject: emailData.Subject,
          source_email_message_id: emailData.MessageID,
          amount_display: null,
          currency_display: null,
        };

        // Currency Conversion
        if (financialItemData.original_amount !== null) {
          financialItemData.currency_display = "USD"; // Default display to USD
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
            financialItemData.amount_display =
              financialItemData.original_amount;
          } else if (financialItemData.original_currency) {
            // Unrecognized but existing original currency
            console.warn(
              `WEBHOOK_WARN: Unrecognized original_currency '${financialItemData.original_currency}'. Using original values for display.`
            );
            financialItemData.amount_display =
              financialItemData.original_amount;
            financialItemData.currency_display =
              financialItemData.original_currency;
          } else {
            // Amount exists, but original currency is null/unknown
            console.warn(
              `WEBHOOK_WARN: Original amount ${financialItemData.original_amount} found, but original_currency is null/unknown. Assuming and displaying as USD.`
            );
            financialItemData.amount_display =
              financialItemData.original_amount;
            // financialItemData.original_currency = "USD"; // Don't assume for original_currency field itself if truly unknown
            financialItemData.currency_display = "USD";
          }
        }
        // If financialItemData.original_amount was null, amount_display and currency_display remain null.

        try {
          savedFinancialItem = await db.addFinancialItem(financialItemData); // This function needs to handle 'category'
          console.log(
            `WEBHOOK_LOG: Financial Item (AI parsed) saved for ${ownerEmail}. ID: ${savedFinancialItem.id}. Category: ${savedFinancialItem.category}`
          );
          slackMessageParts.push(
            `🛍️ Parsed: ${savedFinancialItem.vendor_name} (${
              savedFinancialItem.currency_display || ""
            }${savedFinancialItem.amount_display?.toFixed(2) || "N/A"}, Cat: ${
              savedFinancialItem.category || "N/A"
            })`
          );
        } catch (dbErr) {
          // Check if error code indicates unique constraint violation (PostgreSQL: 23505)
          if (
            dbErr.code === "23505" ||
            (dbErr.message &&
              dbErr.message.toUpperCase().includes("UNIQUE CONSTRAINT") &&
              dbErr.message.includes("source_email_message_id"))
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
            if (savedFinancialItem)
              console.log(
                `WEBHOOK_LOG: Found existing item ID: ${savedFinancialItem.id}`
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
          "WEBHOOK_LOG: OpenAI did not return sufficient financial data (vendor/amount missing), or email not deemed financial by initial check."
        );
      }
    } else {
      console.log(
        "WEBHOOK_LOG: Email not identified as potentially financial. Skipping OpenAI financial parse."
      );
    }

    // Context Highlights Processing (using the "EVEN SAFER LINKING LOGIC" from Turn 59)
    if (emailData.TextBody) {
      allExtractedHighlightsFromThisEmail = extractContextHighlights(
        emailData.TextBody,
        ownerEmail,
        emailData.Subject,
        emailData.MessageID
      );
    }

    if (allExtractedHighlightsFromThisEmail.length > 0) {
      console.log(
        `WEBHOOK_LOG: Extracted ${allExtractedHighlightsFromThisEmail.length} Context Highlight(s) for ${ownerEmail}.`
      );
      let actuallyLinkedHighlightsCount = 0; // For Slack message
      for (let highlight of allExtractedHighlightsFromThisEmail) {
        let itemToLinkTo = savedFinancialItem;
        if (!itemToLinkTo && highlight.product_keyword) {
          itemToLinkTo = await db.findFinancialItemByKeywordAndOwner(
            highlight.product_keyword,
            ownerEmail
          );
        }

        let linkEstablished = false;
        let financialItemIdForLinking = null;

        if (itemToLinkTo) {
          if (highlight.product_keyword) {
            if (
              itemToLinkTo.vendor_name
                ?.toLowerCase()
                .includes(highlight.product_keyword.toLowerCase()) ||
              itemToLinkTo.product_name
                ?.toLowerCase()
                .includes(highlight.product_keyword.toLowerCase())
            ) {
              financialItemIdForLinking = itemToLinkTo.id;
              linkEstablished = true;
            }
          } else if (savedFinancialItem) {
            if (itemToLinkTo.id === savedFinancialItem.id) {
              financialItemIdForLinking = savedFinancialItem.id;
              linkEstablished = true;
            }
          }
        }

        if (linkEstablished && financialItemIdForLinking) {
          highlight.financial_item_id = financialItemIdForLinking;
          console.log(
            `WEBHOOK_LOG: Auto-linking highlight for '${
              highlight.product_keyword || "general context"
            }' to FI ID ${financialItemIdForLinking}`
          );
          actuallyLinkedHighlightsCount++;
        } else if (highlight.product_keyword) {
          /* console.log(...) */
        } else {
          /* console.log(...) */
        }

        try {
          await db.addContextHighlight(highlight);
        } catch (dbErrHighlight) {
          console.warn(
            "WEBHOOK_WARN: Could not save context highlight.",
            dbErrHighlight.message
          );
        }
      }

      if (actuallyLinkedHighlightsCount > 0) {
        slackMessageParts.push(
          `💡 Linked ${actuallyLinkedHighlightsCount} context point(s).`
        );
      } else if (allExtractedHighlightsFromThisEmail.length > 0) {
        slackMessageParts.push(
          `💬 Processed ${allExtractedHighlightsFromThisEmail.length} discussion point(s).`
        );
      }
    }
    // ... (rest of your Slack notification logic and response sending as in Turn 61)
    if (slackMessageParts.length > 0) {
      let finalSlackMessage = `Update for *${ownerEmail}* (Re: ${
        emailData.Subject || "Email Processed"
      }):\n`;
      finalSlackMessage += slackMessageParts
        .map((part) => `- ${part}`)
        .join("\n");
      finalSlackMessage += `\n<${process.env.FRONTEND_URL}/${encodeURIComponent(
        ownerEmail
      )}|View Dashboard>`;
      await sendSlackNotification(finalSlackMessage);
    } else if (savedFinancialItem) {
      await sendSlackNotification(
        `Update for *${ownerEmail}* (Re: ${
          emailData.Subject || "Email Processed"
        }):\n- 🛍️ Financial item parsed: ${savedFinancialItem.vendor_name} (${
          savedFinancialItem.currency_display || ""
        }${savedFinancialItem.amount_display?.toFixed(2) || "N/A"}, Cat: ${
          savedFinancialItem.category || "N/A"
        })` +
          `\n<${process.env.FRONTEND_URL}/${encodeURIComponent(
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
      `WEBHOOK_ERROR: Unhandled error processing email for ${ownerEmail} (Subject: "${emailData.Subject}"):`,
      error
    );
    if (error.stack) console.error("Error Stack:", error.stack);
    await sendSlackNotification(
      `Webhook ERROR for ${ownerEmail} (Re: "${emailData.Subject}"): ${error.message}`
    );
    res.status(500).send("Internal Server Error processing email.");
  }
});

// API Endpoint for Frontend (Make sure it returns category)
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
    const items = await db.getFinancialItemsByOwner(ownerEmailParam); // This SELECTS * so category is included
    const itemsWithContext = [];

    for (const item of items) {
      let allHighlightsForItem = await db.getContextHighlightsForItem(item.id);
      const productKeywordForItem =
        item.vendor_name || item.product_name || item.category; // Added category as a keyword source
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
      itemsWithContext.push({
        ...item,
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

// ICS Endpoint (Ensure this uses amount_display and currency_display for description)
app.get(
  "/api/data/:ownerEmail/financial-items/:itemId/ics",
  async (req, res) => {
    const { ownerEmail, itemId } = req.params;
    // ... (rest of your ICS logic from Turn 57 or 61 is largely fine) ...
    // Make sure inside the `event` description, you use `item.amount_display` and `item.currency_display`
    // Example part of event description:
    // description: `Reminder for ${item.vendor_name}. Cost: ${item.currency_display || '$'}${item.amount_display?.toFixed(2) || 'N/A'}.`,

    // Full ICS logic from Turn 61 (with amount_display adjustment):
    const ownerEmailLower = ownerEmail ? ownerEmail.toLowerCase() : null;
    if (!ownerEmailLower || !itemId)
      return res
        .status(400)
        .json({ error: "Owner email and Item ID are required." });

    try {
      const items = await db.getFinancialItemsByOwner(ownerEmailLower);
      const item = items.find((i) => i.id === itemId);
      if (!item) return res.status(404).send("Financial item not found.");

      if (
        !item.purchase_date ||
        !item.billing_cycle ||
        item.billing_cycle === "one-time"
      ) {
        return res
          .status(400)
          .send(
            "Item is not a recurring subscription or has no valid date for renewal."
          );
      }
      // ... (renewal date calculation as before)
      let nextRenewalDate;
      const purchaseDate = new Date(item.purchase_date);
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      if (item.billing_cycle.toLowerCase() === "monthly") {
        nextRenewalDate = new Date(
          purchaseDate.getFullYear(),
          purchaseDate.getMonth(),
          purchaseDate.getDate()
        );
        while (nextRenewalDate < now)
          nextRenewalDate.setMonth(nextRenewalDate.getMonth() + 1);
      } else if (item.billing_cycle.toLowerCase() === "annually") {
        nextRenewalDate = new Date(
          purchaseDate.getFullYear(),
          purchaseDate.getMonth(),
          purchaseDate.getDate()
        );
        while (nextRenewalDate < now)
          nextRenewalDate.setFullYear(nextRenewalDate.getFullYear() + 1);
      } else {
        return res
          .status(400)
          .send("Unsupported billing cycle for calendar event.");
      }

      const event = {
        title: `Renewal: ${item.vendor_name || "Unknown"} - ${
          item.product_name || "Subscription"
        }`,
        description: `Reminder for ${item.vendor_name || "Unknown"}. Cost: ${
          item.currency_display || "$"
        }${item.amount_display?.toFixed(2) || "N/A"}. From Hub.`, // UPDATED
        start: [
          nextRenewalDate.getFullYear(),
          nextRenewalDate.getMonth() + 1,
          nextRenewalDate.getDate(),
        ],
        duration: { hours: 1 },
        status: "CONFIRMED",
        organizer: {
          name: "Financial Hub",
          email:
            FULL_APP_RECEIVING_EMAIL.split("@")[0] +
            "@" +
            POSTMARK_INBOUND_DOMAIN.split(".").slice(-2).join("."),
        },
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
        console.error("ICS_ERROR:", error);
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
    } catch (err) {
      /* ... */
    }
  }
);

app.get("/", (req, res) =>
  res.send("Brainstormer Hub Backend (OpenAI Parser + Category) is running!")
);
app.listen(PORT, () =>
  console.log(`Backend server running on http://localhost:${PORT}`)
);
