require("dotenv").config();

// backend/server.js
const express = require("express");
const cors = require("cors");
const db = require("./database"); // Our database module

// --- Configuration ---
// 1. Your Postmark Inbound Domain (the part after '@')
//    Find this in your Postmark Server -> Settings -> Inbound Settings
//    It will look like 'your-unique-id.inbound.postmarkapp.com' or your custom inbound domain.
const POSTMARK_INBOUND_DOMAIN =
  process.env.POSTMARK_INBOUND_DOMAIN ||
  "YOUR_UNIQUE_ID.inbound.postmarkapp.com"; // !!! REPLACE THIS if not using .env !!!
// Example: If Postmark shows "anything@abc123xyz.inbound.postmarkapp.com",
// then POSTMARK_INBOUND_DOMAIN should be "abc123xyz.inbound.postmarkapp.com"

// 2. The SINGLE email address your app will receive emails at.
//    Choose a prefix (e.g., 'hub', 'parse', 'data').
//    This full address (e.g., hub@your-unique-id.inbound.postmarkapp.com) is what you'll forward emails TO.
const APP_RECEIVING_EMAIL_PREFIX = "hub"; // You can change "hub" if you like
const FULL_APP_RECEIVING_EMAIL = `${APP_RECEIVING_EMAIL_PREFIX}@${POSTMARK_INBOUND_DOMAIN}`;

// 3. Your Slack Webhook URL (Optional)
//    Find this in your Slack App settings -> Incoming Webhooks
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || ""; // Set this in your environment variables or replace ""

// 4. INR to USD Conversion Rate (Placeholder)
//    Update this with a more accurate or dynamic rate if needed.
const INR_TO_USD_RATE = 0.012; // Example: 1 INR = 0.012 USD

// 5. EUR to USD Conversion Rate (Placeholder)
const EUR_TO_USD_RATE = 1.08; // Example: 1 EUR = 1.08 USD

// 6. GBP to USD Conversion Rate (Placeholder)
const GBP_TO_USD_RATE = 1.27; // Example: 1 GBP = 1.27 USD

const app = express();
const PORT = process.env.PORT || 3001; // Backend runs on this port

// --- Middleware ---
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json({ limit: "10mb" })); // Parse JSON request bodies, increased limit
app.use(express.urlencoded({ extended: true, limit: "10mb" })); // Parse URL-encoded request bodies

console.log(`App configured to receive emails at: ${FULL_APP_RECEIVING_EMAIL}`);
console.log(
  `Ensure Postmark forwards emails sent to this address to your webhook.`
);

// --- Slack Notification Function ---
async function sendSlackNotification(message) {
  console.log("SLACK_NOTIFICATION: Attempting to send notification...");
  console.log(
    `SLACK_NOTIFICATION: SLACK_WEBHOOK_URL value is: '${
      SLACK_WEBHOOK_URL ? "SET" : "NOT SET or EMPTY"
    }'`
  );

  if (!SLACK_WEBHOOK_URL) {
    console.log(
      "SLACK_NOTIFICATION: Slack Webhook URL not configured or empty. Skipping notification."
    );
    return;
  }
  try {
    console.log(`SLACK_NOTIFICATION: Sending payload to Slack: ${message}`);
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
        `SLACK_NOTIFICATION: Error sending Slack notification: ${response.status} ${response.statusText}`,
        await response.text()
      );
    }
  } catch (error) {
    console.error(
      "SLACK_NOTIFICATION: Exception sending Slack notification:",
      error
    );
  }
}

// --- Email Processing Logic (Simplified MVP) ---
function parseFinancialEmail(emailData, ownerEmail) {
  const subject = emailData.Subject || "";
  const body = emailData.TextBody || ""; // Prefer TextBody for easier parsing
  let item = null;

  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();

  // Common financial keywords
  const financialKeywords = [
    "receipt",
    "invoice",
    "payment",
    "bill",
    "statement",
    "order",
    "charge",
    "confirm",
    "subscription",
    "renewal",
    "debit",
    "credit",
    "summary",
    "fee",
  ];

  // General check for financial keywords if no specific vendor matches first
  let isFinancialMail = financialKeywords.some(
    (keyword) => lowerSubject.includes(keyword) || lowerBody.includes(keyword)
  );

  // --- Vendor Specific Parsing ---

  // Example: Netflix
  if (
    lowerSubject.includes("netflix") &&
    (lowerSubject.includes("receipt") ||
      lowerSubject.includes("payment") ||
      lowerSubject.includes("your bill"))
  ) {
    item = {
      vendor_name: "Netflix",
      owner_email: ownerEmail,
      product_name: "Subscription",
      category: "Streaming Services",
    };
    const priceMatch =
      body.match(/\$\s?(\d+\.\d{2})/) || subject.match(/\$\s?(\d+\.\d{2})/);
  }
  // Example: Amazon / AWS
  else if (lowerSubject.includes("amazon") || lowerSubject.includes("aws")) {
    if (
      isFinancialMail ||
      lowerSubject.includes("order confirmation") ||
      lowerSubject.includes("invoice from aws")
    ) {
      item = {
        vendor_name: lowerSubject.includes("aws") ? "AWS" : "Amazon",
        owner_email: ownerEmail,
        category: "Online Retail",
      };
    }
  }
  // Example: Spotify
  else if (lowerSubject.includes("spotify")) {
    if (
      isFinancialMail ||
      lowerSubject.includes("subscription") ||
      lowerSubject.includes("receipt")
    ) {
      item = {
        vendor_name: "Spotify",
        owner_email: ownerEmail,
        category: "Streaming Services",
      };
    }
  }
  // Example: Zoom
  else if (lowerSubject.includes("zoom")) {
    if (
      isFinancialMail ||
      lowerSubject.includes("invoice") ||
      lowerSubject.includes("subscription")
    ) {
      item = {
        vendor_name: "Zoom",
        owner_email: ownerEmail,
        category: "Video Conferencing",
      };
    }
  }
  // Example: Microsoft / Office / Xbox
  else if (
    lowerSubject.includes("microsoft") ||
    lowerSubject.includes("office 365") ||
    lowerSubject.includes("xbox")
  ) {
    if (
      isFinancialMail ||
      lowerSubject.includes("subscription") ||
      lowerSubject.includes("invoice") ||
      lowerSubject.includes("billing")
    ) {
      let vendor = "Microsoft";
      if (lowerSubject.includes("office 365")) vendor = "Microsoft Office 365";
      if (lowerSubject.includes("xbox")) vendor = "Microsoft Xbox";
      item = {
        vendor_name: vendor,
        owner_email: ownerEmail,
        category: "Software",
      };
    }
  }
  // Example: Google (Play, Workspace, Ads, Cloud)
  else if (lowerSubject.includes("google")) {
    if (
      isFinancialMail ||
      lowerSubject.includes("receipt") ||
      lowerSubject.includes("invoice") ||
      lowerSubject.includes("statement") ||
      lowerSubject.includes("subscription")
    ) {
      let vendor = "Google";
      if (lowerSubject.includes("google play")) vendor = "Google Play";
      if (lowerSubject.includes("google workspace"))
        vendor = "Google Workspace";
      if (lowerSubject.includes("google ads")) vendor = "Google Ads";
      if (lowerSubject.includes("google cloud")) vendor = "Google Cloud";
      item = {
        vendor_name: vendor,
        owner_email: ownerEmail,
        category: "Software",
      };
    }
  }
  // Example: Apple (App Store, iCloud, Music)
  else if (
    lowerSubject.includes("apple") ||
    lowerSubject.includes("itunes store") ||
    lowerSubject.includes("app store")
  ) {
    if (
      isFinancialMail ||
      lowerSubject.includes("receipt") ||
      lowerSubject.includes("invoice") ||
      lowerSubject.includes("subscription")
    ) {
      let vendor = "Apple";
      if (lowerSubject.includes("icloud")) vendor = "Apple iCloud";
      if (lowerSubject.includes("apple music")) vendor = "Apple Music";
      item = {
        vendor_name: vendor,
        owner_email: ownerEmail,
        category: "Software",
      };
    }
  }
  // --- Generic Financial Email (if no specific vendor was matched but keywords were present) ---
  else if (item === null && isFinancialMail) {
    // Try to guess vendor from subject if possible, or use a generic name
    let guessedVendor = "Unknown Vendor";
    // A simple heuristic: look for names/words before common financial terms
    const commonSeparators = [
      "receipt for",
      "invoice for",
      "payment to",
      "order from",
      "bill from",
    ];
    for (const separator of commonSeparators) {
      if (lowerSubject.includes(separator)) {
        const potentialVendor = subject
          .substring(lowerSubject.indexOf(separator) + separator.length)
          .trim()
          .split(/\s|\(|\-/)[0];
        if (potentialVendor && potentialVendor.length > 2) {
          // Basic check
          guessedVendor =
            potentialVendor.charAt(0).toUpperCase() + potentialVendor.slice(1);
          break;
        }
      }
    }

    console.log(
      `Generic financial email detected, determined vendor: ${guessedVendor}`
    );
    item = {
      vendor_name: guessedVendor,
      owner_email: ownerEmail,
      is_generic: true,
      category: "Unknown",
    };
  }

  // If an item was identified (either vendor-specific or generic financial)
  if (item) {
    // Price and Currency Extraction (common for all)
    // Regex for common currency symbols and amounts (e.g., $, £, €, ₹, CAD, AUD, Rs, Rs., INR)
    // It captures the symbol and the amount. Ensures at least one digit is present in the amount.
    const priceRegex =
      /(?:(?:USD|\$|EUR|€|GBP|£|INR|₹|Rs\.?|CAD|AUD)\s?|\s?)(\d[\d,]*(?:\.\d{1,2})?)/i;

    // Fallback regex for amounts that might not have explicit currency symbols but must contain at least one digit.
    const priceRegexFallback = /(\d[\d,]*(?:\.\d{1,2})?)/;

    let priceMatch = body.match(priceRegex) || subject.match(priceRegex);
    if (!priceMatch) {
      console.log(
        "DEBUG: Price parsing - Primary regex failed, trying fallback regex."
      ); // Added logging
      priceMatch =
        body.match(priceRegexFallback) || subject.match(priceRegexFallback);
    }

    if (priceMatch && priceMatch[1]) {
      const rawMatchedPrice = priceMatch[1];
      let extractedPrice = parseFloat(rawMatchedPrice.replace(/,/g, ""));

      console.log(
        `DEBUG: Price parsing - Matched string: "${priceMatch[0]}", Raw matched price: "${rawMatchedPrice}", Parsed float before NaN check: ${extractedPrice}`
      ); // Added logging

      if (isNaN(extractedPrice)) {
        console.warn(
          `DEBUG: Price parsing - extractedPrice is NaN for raw value "${rawMatchedPrice}". Setting financial amounts to null.`
        ); // Added logging
        item.original_amount = null;
        item.original_currency = null;
        item.amount_display = null;
        item.currency_display = null; // Explicitly null if amount is not parsable
      } else {
        item.original_amount = extractedPrice;
        const matchedString = priceMatch[0].toLowerCase();
        console.log(
          `DEBUG: Price parsing - Successfully parsed extractedPrice: ${item.original_amount}. Matched string for currency: "${matchedString}"`
        ); // Added logging

        if (
          matchedString.includes("$") ||
          matchedString.includes("usd") ||
          matchedString.includes("cad") ||
          matchedString.includes("aud")
        ) {
          item.original_currency = "USD";
        } else if (
          matchedString.includes("€") ||
          matchedString.includes("eur")
        ) {
          item.original_currency = "EUR";
        } else if (
          matchedString.includes("£") ||
          matchedString.includes("gbp")
        ) {
          item.original_currency = "GBP";
        } else if (
          matchedString.includes("₹") ||
          matchedString.includes("rs") ||
          matchedString.includes("inr")
        ) {
          item.original_currency = "INR";
        } else {
          item.original_currency = "USD"; // Default original currency if not identifiable
          console.log(
            `DEBUG: Price parsing - Currency not clearly identified in "${matchedString}", defaulting original_currency to USD.`
          ); // Added logging
        }
        console.log(
          `DEBUG: Price parsing - Identified original_currency: ${item.original_currency}`
        ); // Added logging

        // Set display amount and currency (convert ALL to USD for display)
        item.currency_display = "USD"; // Display currency will always be USD

        if (item.original_currency === "INR") {
          item.amount_display = parseFloat(
            (extractedPrice * INR_TO_USD_RATE).toFixed(2)
          );
        } else if (item.original_currency === "EUR") {
          item.amount_display = parseFloat(
            (extractedPrice * EUR_TO_USD_RATE).toFixed(2)
          );
        } else if (item.original_currency === "GBP") {
          item.amount_display = parseFloat(
            (extractedPrice * GBP_TO_USD_RATE).toFixed(2)
          );
        } else if (item.original_currency === "USD") {
          // CAD and AUD are currently grouped with USD as original_currency. If they were separate,
          // you would add specific conversion rates for them here too if desired.
          // For now, if original_currency is USD (or by extension CAD/AUD as per current parsing),
          // amount_display is the same.
          item.amount_display = extractedPrice;
        } else {
          // This case should ideally not be hit if default is USD.
          // For any other unhandled original currencies (that defaulted to USD original_currency)
          // or if new original_currency types are added without explicit conversion here.
          console.warn(
            `DEBUG: Price parsing - Unhandled original_currency "${item.original_currency}" for USD conversion. Using original amount ${extractedPrice} for display amount.`
          ); // Added logging
          item.amount_display = extractedPrice; // Default to using the extracted price as is for USD display
        }
        console.log(
          `DEBUG: Price parsing - Final amount_display: ${item.amount_display}, currency_display: ${item.currency_display}`
        ); // Added logging
      }
    } else {
      console.log(
        "DEBUG: Price parsing - No priceMatch found in subject or body. Setting financial amount/currency fields to null."
      ); // Added logging
      // Default if no price found
      item.original_amount = null;
      item.original_currency = null;
      item.amount_display = null;
      item.currency_display = null; // Explicitly null if no amount found
    }

    // Billing Cycle Extraction (common for all)
    if (
      lowerBody.includes("monthly") ||
      lowerSubject.includes("monthly") ||
      lowerBody.includes("per month") ||
      lowerSubject.includes("per month")
    ) {
      item.billing_cycle = "monthly";
    } else if (
      lowerBody.includes("annual") ||
      lowerSubject.includes("annual") ||
      lowerBody.includes("yearly") ||
      lowerSubject.includes("yearly") ||
      lowerBody.includes("per year") ||
      lowerSubject.includes("per year")
    ) {
      item.billing_cycle = "annually";
    } else if (
      lowerBody.includes("quarterly") ||
      lowerSubject.includes("quarterly")
    ) {
      item.billing_cycle = "quarterly";
    } else {
      item.billing_cycle = "one-time"; // Default or for purchases
    }

    // Date Extraction (common for all)
    const dateMatchPatterns = [
      /Date:?\s*([A-Za-z]+\s\d{1,2}(?:st|nd|rd|th)?,?\s\d{4})/i, // "Date: May 27th, 2025", "Date: May 27, 2025"
      /([A-Za-z]{3,9}\s\d{1,2}(?:st|nd|rd|th)?,?\s\d{4})/i, // "May 27, 2025", "May 27th, 2025"
      /(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i, // "05/27/2025", "27-05-2025", "05.27.2025"
      /(\d{4}[\/\.\-]\d{1,2}[\/\.\-]\d{1,2})/i, // "2025/05/27", "2025-05-27"
    ];
    for (const pattern of dateMatchPatterns) {
      const dateMatch = body.match(pattern) || subject.match(pattern);
      if (dateMatch && dateMatch[1]) {
        try {
          // Attempt to standardize various date formats before creating Date object
          let dateStr = dateMatch[1].replace(/(?:st|nd|rd|th),?/g, ","); // Remove ordinals
          item.purchase_date = new Date(dateStr).toISOString();
          break;
        } catch (e) {
          console.warn("Date parsing failed for string:", dateMatch[1], e);
        }
      }
    }
    if (!item.purchase_date)
      item.purchase_date = new Date(emailData.Date || Date.now()).toISOString(); // Fallback to email header date or now

    // Product Name (Simplified)
    item.product_name =
      item.billing_cycle !== "one-time"
        ? `${item.vendor_name} Subscription - ${item.billing_cycle}`
        : `${item.vendor_name} Purchase/Order`;
    if (item.is_generic && item.vendor_name === "Unknown Vendor") {
      item.product_name =
        financialKeywords.find(
          (kw) => lowerSubject.includes(kw) || lowerBody.includes(kw)
        ) || "Financial Transaction";
      item.product_name =
        item.product_name.charAt(0).toUpperCase() + item.product_name.slice(1);
      if (item.billing_cycle !== "one-time")
        item.product_name += ` - ${item.billing_cycle}`;
    }
  }
  // TODO: Add more parsers here for other specific vendors: Uber, Lyft, DoorDash, utilities etc.
  // Consider looking at emailData.From for sender-specific parsing rules more deeply.

  if (item) {
    item.raw_email_subject = subject;
    item.source_email_message_id = emailData.MessageID; // Provided by Postmark
  }
  return item;
}

function extractContextHighlights(emailData, ownerEmail) {
  const subject = emailData.Subject || "";
  const body = emailData.TextBody || "";
  const highlights = [];
  let productKeyword = null;
  console.log(
    `DEBUG CONTEXT: Starting highlight extraction for subject: "${subject}", owner: ${ownerEmail}`
  ); // Added log

  // Try to identify product/service names mentioned in the email
  const knownServices = [
    "Zoom",
    "Asana",
    "Netflix",
    "Spotify",
    "AWS",
    "Office",
    "Adobe",
    "Canva",
    "Figma",
  ]; // Expand this list
  for (const service of knownServices) {
    if (
      subject.toLowerCase().includes(service.toLowerCase()) ||
      body.toLowerCase().includes(service.toLowerCase())
    ) {
      productKeyword = service; // Take the first one found for simplicity
      console.log(
        `DEBUG CONTEXT: Identified productKeyword: "${productKeyword}"`
      ); // Added log
      break;
    }
  }
  if (!productKeyword) {
    console.log(
      "DEBUG CONTEXT: No productKeyword identified from knownServices."
    ); // Added log
  }

  // Example patterns for extracting highlights (case-insensitive, global search)
  const patterns = [
    {
      regex: /reason for .* is (.+?)(?:\.|\n|$|but|and|so)/gi,
      label: "Reason",
    },
    {
      regex: /decided on .* because (.+?)(?:\.|\n|$|but|and|so)/gi,
      label: "Decision Factor",
    },
    { regex: /issue with .* is (.+?)(?:\.|\n|$|but|and|so)/gi, label: "Issue" },
    {
      regex: /benefit of .* is (.+?)(?:\.|\n|$|but|and|so)/gi,
      label: "Benefit",
    },
    { regex: /problem.* is (.+?)(?:\.|\n|$|but|and|so)/gi, label: "Problem" },
    { regex: /solution.* is (.+?)(?:\.|\n|$|but|and|so)/gi, label: "Solution" },
  ];

  patterns.forEach((patternInfo) => {
    let match;
    // Reset lastIndex for global regex in a loop if you re-use the regex object directly
    // For dynamically created regex like this, it's fine per iteration.
    const currentRegex = new RegExp(patternInfo.regex);
    console.log(
      `DEBUG CONTEXT: Trying regex pattern for "${patternInfo.label}"`
    ); // Added log
    while ((match = currentRegex.exec(body)) !== null) {
      if (match[1] && match[1].trim().length > 10) {
        // Ensure snippet is somewhat substantial
        console.log(
          `DEBUG CONTEXT: Regex pattern "${
            patternInfo.label
          }" matched: "${match[1].trim()}"`
        ); // Added log
        highlights.push({
          owner_email: ownerEmail,
          product_keyword: productKeyword, // Will be null if no known service found
          highlight_text: `${patternInfo.label}: ${match[1].trim()}`,
          source_email_subject: subject,
          source_email_message_id: emailData.MessageID,
        });
      }
    }
  });

  // Fallback: If no specific patterns matched but a product keyword was found,
  // and the body is somewhat long, grab a generic context snippet.
  if (highlights.length === 0 && productKeyword && body && body.length > 50) {
    console.log(
      `DEBUG CONTEXT: No specific patterns matched. Attempting fallback highlight for productKeyword: "${productKeyword}"`
    ); // Added log
    highlights.push({
      owner_email: ownerEmail,
      product_keyword: productKeyword,
      highlight_text: `General context related to ${productKeyword}: ${body
        .substring(0, 250)
        .replace(/\s+/g, " ")
        .trim()}...`,
      source_email_subject: subject,
      source_email_message_id: emailData.MessageID,
    });
  }
  console.log(
    `DEBUG CONTEXT: Finished highlight extraction. Found ${highlights.length} highlights.`
  ); // Added log
  return highlights;
}

// --- Webhook for Postmark ---
app.post("/webhook/email-inbound", async (req, res) => {
  console.log("POSTMARK WEBHOOK: Received an email.");
  const emailData = req.body; // Postmark sends JSON

  console.log("emailData", emailData);
  // Determine the "owner" of this email data.
  // This is the email address of the person who sent/forwarded the email TO the hub.
  const ownerEmail =
    emailData.FromFull && emailData.FromFull.Email
      ? emailData.FromFull.Email.toLowerCase()
      : null;

  if (!ownerEmail) {
    console.warn(
      "WEBHOOK: Could not determine sender's (owner) email from FromFull. Ignoring."
    );
    return res
      .status(200)
      .send("Sender email not found in FromFull, but webhook received."); // Acknowledge Postmark
  }

  // Optional: Check if the email was indeed sent to your app's dedicated address
  // This is good for sanity, especially if your Postmark domain might receive other emails.
  let addressedToApp = false;
  const targetEmailLower = FULL_APP_RECEIVING_EMAIL.toLowerCase();

  // Helper to check a list of recipients (like ToFull, CcFull, BccFull)
  // Postmark typically sends these as arrays of objects. Handles single object defensively.
  const checkRecipientList = (list) => {
    if (!list) return false;
    const recipients = Array.isArray(list) ? list : [list]; // Ensure we iterate over an array
    return recipients.some(
      (recipient) =>
        recipient &&
        recipient.Email &&
        recipient.Email.toLowerCase() === targetEmailLower
    );
  };

  // 1. Check OriginalRecipient (most definitive for Postmark routing)
  if (
    emailData.OriginalRecipient &&
    emailData.OriginalRecipient.toLowerCase() === targetEmailLower
  ) {
    addressedToApp = true;
  }

  // 2. Check ToFull header
  if (!addressedToApp && checkRecipientList(emailData.ToFull)) {
    addressedToApp = true;
  }

  // 3. Check CcFull header
  if (!addressedToApp && checkRecipientList(emailData.CcFull)) {
    addressedToApp = true;
  }

  // 4. Check BccFull header (relevant for the sample data where target is in BCC)
  if (!addressedToApp && checkRecipientList(emailData.BccFull)) {
    addressedToApp = true;
  }

  // If Postmark routes based on a catch-all or specific rule to this webhook,
  // this check might be redundant, but we'll log if it wasn't directly to the main app address.
  if (!addressedToApp) {
    console.log(
      `WEBHOOK: Email not directly addressed to ${FULL_APP_RECEIVING_EMAIL}. Original Recipient: ${
        emailData.OriginalRecipient || JSON.stringify(emailData.ToFull)
      }. Processing for owner: ${ownerEmail}`
    );
  }

  console.log(
    `WEBHOOK: Processing email for owner ${ownerEmail}: "${emailData.Subject}" (Original From: ${emailData.From})`
  );

  try {
    // 1. Try to parse as a financial email
    const financialItemData = parseFinancialEmail(emailData, ownerEmail);
    let savedFinancialItem = null;

    if (financialItemData) {
      console.log(
        "WEBHOOK: Parsed as Financial Item:",
        financialItemData.vendor_name,
        financialItemData.amount_display // Changed from price
      );
      console.log(
        "DEBUG PAYLOAD PRE-SAVE: financialItemData details - Vendor: '" +
          financialItemData.vendor_name +
          "', Category: '" +
          financialItemData.category +
          "', Owner: '" +
          financialItemData.owner_email +
          "', Product: '" +
          financialItemData.product_name +
          "', MsgID: '" +
          financialItemData.source_email_message_id +
          "'"
      );
      try {
        savedFinancialItem = await db.addFinancialItem(financialItemData);
        console.log(
          `WEBHOOK: Financial Item saved for ${ownerEmail}. ID: ${savedFinancialItem.id}`
        );
        await sendSlackNotification(
          `Webhook: New financial item saved for ${ownerEmail} from email (Subject: "${
            emailData.Subject
          }"). Vendor: ${financialItemData.vendor_name}, Price: ${
            financialItemData.amount_display || "N/A"
          } ${financialItemData.currency_display || ""}.` // Updated price to amount_display and added currency_display
        );
      } catch (dbErr) {
        if (
          dbErr.message &&
          dbErr.message.includes(
            "UNIQUE constraint failed: FinancialItems.source_email_message_id"
          )
        ) {
          console.log(
            `WEBHOOK: Financial Item from MessageID ${financialItemData.source_email_message_id} already exists for ${ownerEmail}. Skipping save.`
          );
        } else {
          console.error("WEBHOOK: DB Error saving financial item:", dbErr);
          throw dbErr; // Re-throw other DB errors to be caught by outer try-catch
        }
      }
    }

    // 2. Extract context highlights (can happen even if it wasn't a financial email, or from the same email)
    const highlights = extractContextHighlights(emailData, ownerEmail);
    if (highlights.length > 0) {
      console.log(
        `WEBHOOK: Extracted ${
          highlights.length
        } Context Highlight(s) for ${ownerEmail}. First highlight preview: ${JSON.stringify(
          highlights[0]
        )}` // Modified log
      );
      await sendSlackNotification(
        `Webhook: Extracted ${highlights.length} context highlight(s) for ${ownerEmail} from email (Subject: "${emailData.Subject}").`
      );
      for (let highlight of highlights) {
        // Attempt to auto-link if a product keyword was found and a financial item matches for this owner
        // Prioritize the currently processed financial item if one was just saved.
        let itemToLink = savedFinancialItem;
        if (!itemToLink && highlight.product_keyword) {
          // If no current item, or current item doesn't match keyword
          itemToLink = await db.findFinancialItemByKeywordAndOwner(
            highlight.product_keyword,
            ownerEmail
          );
        }

        if (
          itemToLink &&
          highlight.product_keyword &&
          (itemToLink.vendor_name
            ?.toLowerCase()
            .includes(highlight.product_keyword.toLowerCase()) ||
            itemToLink.product_name
              ?.toLowerCase()
              .includes(highlight.product_keyword.toLowerCase()))
        ) {
          highlight.financial_item_id = itemToLink.id;
          console.log(
            `WEBHOOK: Auto-linking highlight for '${highlight.product_keyword}' to financial item ID ${itemToLink.id} (Vendor: ${itemToLink.vendor_name}, Product: ${itemToLink.product_name}) for owner ${ownerEmail}` // Modified log
          );
        } else if (highlight.product_keyword) {
          console.log(
            `WEBHOOK: No matching financial item found to auto-link for keyword '${
              highlight.product_keyword
            }' for owner ${ownerEmail}. Financial item to link was: ${
              itemToLink
                ? "Found (ID: " +
                  itemToLink.id +
                  " Vendor: " +
                  itemToLink.vendor_name +
                  ")"
                : "Not Found"
            }. Saving highlight unlinked or keyword-linked.` // Modified log
          );
        }

        try {
          await db.addContextHighlight(highlight);
          console.log(
            `WEBHOOK: Successfully saved highlight: "${highlight.highlight_text.substring(
              0,
              50
            )}..." for owner ${ownerEmail}`
          ); // Added log
        } catch (dbErr) {
          if (
            dbErr.message &&
            dbErr.message.includes("UNIQUE constraint failed")
          ) {
            // Assume highlights table has unique constraints if needed
            console.log(
              "WEBHOOK: Context highlight might already exist. Skipping save."
            );
          } else {
            console.error("WEBHOOK: DB Error saving context highlight:", dbErr);
            // Decide if this should stop processing or just log
          }
        }
      }
      console.log(`WEBHOOK: Context Highlights processed for ${ownerEmail}.`);
    }

    if (!financialItemData && highlights.length === 0) {
      console.log(
        `WEBHOOK: Email for ${ownerEmail} was not parsed as financial and no context highlights extracted.`
      );
      await sendSlackNotification(
        `Webhook: Received an email for ${ownerEmail} (Subject: "${
          emailData.Subject
        }", Original Sender: ${
          emailData.From
        }). This email was not identified as a financial transaction, and no context highlights were extracted. Email Date: ${new Date(
          emailData.Date
        ).toLocaleString()}. Body preview: "${
          emailData.TextBody
            ? emailData.TextBody.substring(0, 120).replace(/\s+/g, " ").trim() +
              "..."
            : "(No text body)"
        }"`
      );
    }
    res.status(200).send("Email processed by Hub.");
    // Send a general success notification to Slack if something was processed
    if (financialItemData || highlights.length > 0) {
      await sendSlackNotification(
        `Webhook: Successfully processed email for ${ownerEmail} (Subject: "${
          emailData.Subject
        }"). Found: ${financialItemData ? "Financial Item" : ""}${
          financialItemData && highlights.length > 0 ? " & " : ""
        }${highlights.length > 0 ? highlights.length + " Highlight(s)" : ""}.`
      );
    }
  } catch (error) {
    console.error(`WEBHOOK: Error processing email for ${ownerEmail}:`, error);
    await sendSlackNotification(
      `Webhook ERROR: Failed to process email for ${ownerEmail} (Subject: "${emailData.Subject}"). Error: ${error.message}`
    );
    res.status(500).send("Error processing email.");
  }
});

// --- API Endpoints for Frontend ---
app.get("/api/data/:ownerEmail/financial-items", async (req, res) => {
  const ownerEmail = req.params.ownerEmail
    ? req.params.ownerEmail.toLowerCase()
    : null;
  if (!ownerEmail) {
    return res
      .status(400)
      .json({ error: "Owner email parameter is required." });
  }
  console.log(`API: Fetching financial items for owner: ${ownerEmail}`);
  try {
    const items = await db.getFinancialItemsByOwner(ownerEmail);
    const itemsWithContext = [];

    for (const item of items) {
      let allHighlights = [];
      // 1. Get highlights directly linked by financial_item_id
      const linkedHighlights = await db.getContextHighlightsForItem(item.id);
      allHighlights.push(...linkedHighlights);

      // 2. Get highlights for the same owner and product keyword that are not yet linked
      //    (useful if highlights were processed from a separate email)
      const productKeywordForItem = item.vendor_name || item.product_name; // Use vendor or product name as keyword
      if (productKeywordForItem) {
        const keywordHighlights =
          await db.getContextHighlightsByProductKeywordAndOwner(
            productKeywordForItem,
            ownerEmail
          );
        keywordHighlights.forEach((kh) => {
          // Add only if not already present (to avoid duplicates if it was already directly linked)
          // and ensure it's for the same owner and product (already filtered by SQL for keywordHighlights)
          if (!allHighlights.find((ah) => ah.id === kh.id)) {
            allHighlights.push(kh);
          }
        });
      }
      itemsWithContext.push({ ...item, context_highlights: allHighlights });
    }
    res.json(itemsWithContext);
  } catch (error) {
    console.error(
      `API: Error fetching financial items for ${ownerEmail}:`,
      error
    );
    res.status(500).json({ error: "Failed to fetch financial items" });
  }
});

// --- Basic Root Route & Start Server ---
app.get("/", (req, res) => {
  res.send("Brainstormer Hub Backend (Implicit User Version) is running!");
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
