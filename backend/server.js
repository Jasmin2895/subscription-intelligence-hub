require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./database");
const { extractContextHighlights } = require("./utils/contextExtractor");
const { getStructuredDataFromEmail } = require("./services/openAiService");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const ics = require("ics");
const pdf = require("pdf-parse");

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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

console.log(
  `SERVER_LOG: App configured to receive emails at: ${FULL_APP_RECEIVING_EMAIL}`
);
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "SERVER_WARN: OPENAI_API_KEY not found in .env file. Financial email parsing will likely fail."
  );
}
if (!SLACK_WEBHOOK_URL && process.env.NODE_ENV !== "test") {
  console.warn(
    "SERVER_WARN: SLACK_WEBHOOK_URL not found in .env or empty. Slack notifications will be skipped."
  );
}

async function sendSlackNotification(message) {
  console.log("SLACK_LOG: Attempting to send notification...");
  if (!SLACK_WEBHOOK_URL) {
    console.log(
      "SLACK_LOG: Slack Webhook URL not configured or empty. Skipping notification."
    );
    return;
  }
  try {
    console.log(`SLACK_LOG: Sending payload to Slack: ${message}`);
    const payload = { text: message };
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

app.post("/webhook/email-inbound", async (req, res) => {
  const webhookReceivedTime = Date.now();
  console.log(
    "WEBHOOK_LOG: Received an email at",
    new Date(webhookReceivedTime).toISOString()
  );
  const emailData = req.body;

  let combinedTextBody = emailData.TextBody || "";
  let attachmentInfoForSlack = [];

  if (
    emailData.Attachments &&
    Array.isArray(emailData.Attachments) &&
    emailData.Attachments.length > 0
  ) {
    console.log(
      `WEBHOOK_LOG: Email contains ${emailData.Attachments.length} attachment(s).`
    );

    for (const attachment of emailData.Attachments) {
      attachmentInfoForSlack.push(
        `${attachment.Name} (${attachment.ContentType})`
      );
      try {
        if (
          attachment.ContentType.startsWith("text/") ||
          attachment.ContentType === "application/json"
        ) {
          const decodedContent = Buffer.from(
            attachment.Content,
            "base64"
          ).toString("utf8");

          combinedTextBody += `\n\n--- ATTACHMENT CONTENT (${attachment.Name}) ---\n${decodedContent}`;
          console.log(
            `WEBHOOK_LOG: Extracted and appended text from attachment: ${attachment.Name}`
          );
        } else if (attachment.ContentType === "application/pdf") {
          console.log(
            `WEBHOOK_LOG: PDF attachment found: ${attachment.Name}. Attempting to parse...`
          );
          try {
            const pdfBuffer = Buffer.from(attachment.Content, "base64");
            const data = await pdf(pdfBuffer);
            combinedTextBody += `\n\n--- ATTACHMENT CONTENT (from PDF: ${attachment.Name}) ---\n${data.text}`;
            console.log(
              `WEBHOOK_LOG: Successfully extracted text from PDF: ${attachment.Name}`
            );
          } catch (pdfError) {
            console.error(
              `WEBHOOK_ERROR: Could not parse corrupt PDF '${attachment.Name}'. Error: ${pdfError.message}`
            );
          }
        } else {
          console.log(
            `WEBHOOK_LOG: Skipping content extraction for attachment '${attachment.Name}' of type '${attachment.ContentType}'. This file type is not currently supported.`
          );
        }
      } catch (e) {
        console.error(
          `WEBHOOK_ERROR: Failed to decode or process attachment ${attachment.Name}.`,
          e
        );
      }
    }
  }

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
    console.log(
      "WEBHOOK_LOG: Attempting to parse email with OpenAI to identify financial data..."
    );
    const aiParsedData = await getStructuredDataFromEmail(
      emailData.Subject,
      combinedTextBody
    );

    if (
      aiParsedData &&
      aiParsedData.vendor_name &&
      aiParsedData.original_amount !== null
    ) {
      console.log(
        "WEBHOOK_LOG: OpenAI successfully parsed financial data: Vendor: '%s', Amount: %s %s",
        aiParsedData.vendor_name,
        aiParsedData.original_amount,
        aiParsedData.original_currency
      );

      let purchaseDateISO = null;
      if (aiParsedData.purchase_date) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(aiParsedData.purchase_date)) {
          const d = new Date(aiParsedData.purchase_date + "T00:00:00Z");
          if (!isNaN(d)) purchaseDateISO = d.toISOString();
        } else {
          try {
            const d = new Date(aiParsedData.purchase_date);
            if (!isNaN(d.getTime())) {
              purchaseDateISO = d.toISOString();
            }
          } catch (e) {
            console.warn("Date re-parse error", e);
          }
        }
      }
      if (!purchaseDateISO)
        purchaseDateISO = new Date(emailData.Date || Date.now()).toISOString();

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
        category: aiParsedData.category || "Other",
        raw_email_subject: emailData.Subject,
        source_email_message_id: emailData.MessageID,
        amount_display: null,
        currency_display: null,
      };

      if (financialItemData.original_amount !== null) {
        financialItemData.currency_display = "USD";
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
        } else if (financialItemData.original_currency) {
          console.warn(
            `WEBHOOK_WARN: Unrecognized original_currency '${financialItemData.original_currency}'. Using original values for display.`
          );
          financialItemData.amount_display = financialItemData.original_amount;
          financialItemData.currency_display =
            financialItemData.original_currency;
        } else {
          console.warn(
            `WEBHOOK_WARN: Original amount ${financialItemData.original_amount} found, but original_currency is null/unknown. Assuming and displaying as USD.`
          );
          financialItemData.amount_display = financialItemData.original_amount;
          financialItemData.currency_display = "USD";
        }
      }

      try {
        savedFinancialItem = await db.addFinancialItem(financialItemData);
        console.log(
          `WEBHOOK_LOG: Financial Item saved for ${ownerEmail}. ID: ${savedFinancialItem.id}. Category: ${savedFinancialItem.category}`
        );
        slackMessageParts.push(
          `🛍️ Parsed: ${savedFinancialItem.vendor_name} (${
            savedFinancialItem.currency_display || ""
          }${savedFinancialItem.amount_display?.toFixed(2) || "N/A"}, Cat: ${
            savedFinancialItem.category || "N/A"
          })`
        );
      } catch (dbErr) {
        if (
          dbErr.code === "23505" ||
          (dbErr.message &&
            dbErr.message.toUpperCase().includes("UNIQUE CONSTRAINT"))
        ) {
          console.log(
            `WEBHOOK_LOG: Financial Item from MessageID ${financialItemData.source_email_message_id} already exists. Fetching.`
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
            "WEBHOOK_ERROR: DB Error saving financial item:",
            dbErr
          );
          throw dbErr;
        }
      }
    } else {
      console.log(
        "WEBHOOK_LOG: OpenAI did not return sufficient financial data. Assuming email is non-financial."
      );
    }

    if (combinedTextBody) {
      allExtractedHighlightsFromThisEmail = extractContextHighlights(
        combinedTextBody,
        ownerEmail,
        emailData.Subject,
        emailData.MessageID
      );
    }

    if (allExtractedHighlightsFromThisEmail.length > 0) {
      console.log(
        `WEBHOOK_LOG: Extracted ${allExtractedHighlightsFromThisEmail.length} Context Highlight(s) for ${ownerEmail}.`
      );
      let actuallyLinkedHighlightsCount = 0;
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

    if (slackMessageParts.length > 0) {
      let finalSlackMessage = `Update for *${ownerEmail}* (Re: ${
        emailData.Subject || "Email Processed"
      }):\n`;
      finalSlackMessage += slackMessageParts
        .map((part) => `- ${part}`)
        .join("\n");
      if (attachmentInfoForSlack.length > 0) {
        finalSlackMessage += `\n- 📎 Processed ${
          attachmentInfoForSlack.length
        } attachment(s): _${attachmentInfoForSlack.join(", ")}_`;
      }
      finalSlackMessage += `\n<${process.env.FRONTEND_URL}/${encodeURIComponent(
        ownerEmail
      )}|View Dashboard>`;
      await sendSlackNotification(finalSlackMessage);
    } else if (savedFinancialItem) {
      let baseMessage = `Update for *${ownerEmail}* (Re: ${
        emailData.Subject || "Email Processed"
      }):\n- 🛍️ Financial item parsed: ${savedFinancialItem.vendor_name} (${
        savedFinancialItem.currency_display || ""
      }${savedFinancialItem.amount_display?.toFixed(2) || "N/A"}, Cat: ${
        savedFinancialItem.category || "N/A"
      })`;
      if (attachmentInfoForSlack.length > 0) {
        baseMessage += `\n- 📎 Processed ${
          attachmentInfoForSlack.length
        } attachment(s): _${attachmentInfoForSlack.join(", ")}_`;
      }
      baseMessage += `\n<${process.env.FRONTEND_URL}/${encodeURIComponent(
        ownerEmail
      )}|View Dashboard>`;
      await sendSlackNotification(baseMessage);
    } else if (attachmentInfoForSlack.length > 0) {
      await sendSlackNotification(
        `Update for *${ownerEmail}* (Re: ${
          emailData.Subject || "Email Processed"
        }):\n- 📎 Processed ${
          attachmentInfoForSlack.length
        } attachment(s): _${attachmentInfoForSlack.join(", ")}_` +
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
      const productKeywordForItem =
        item.vendor_name || item.product_name || item.category;
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

app.get(
  "/api/data/:ownerEmail/financial-items/:itemId/ics",
  async (req, res) => {
    const { ownerEmail, itemId } = req.params;
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
        }${item.amount_display?.toFixed(2) || "N/A"}. From Hub.`,
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
      console.error(
        `API_ERROR: ICS generation for ${ownerEmailLower}, item ${itemId}:`,
        err
      );
      res.status(500).json({ error: "Failed to generate iCalendar file." });
    }
  }
);

app.get("/", (req, res) =>
  res.send("Brainstormer Hub Backend (OpenAI Parser + Category) is running!")
);
app.listen(PORT, () =>
  console.log(`Backend server running on http://localhost:${PORT}`)
);
