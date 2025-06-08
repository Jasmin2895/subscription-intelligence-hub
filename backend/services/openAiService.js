require("dotenv").config();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const financialCategories = [
  "Groceries",
  "Utilities",
  "Software",
  "Subscription",
  "Electronics",
  "Clothing",
  "Travel",
  "Transportation",
  "Food & Dining",
  "Entertainment",
  "Online Retail",
  "Professional Services",
  "Healthcare",
  "Education",
  "Home Goods",
  "Gifts & Donations",
  "Financial Services",
  "Business Services",
  "Cloud Services",
  "Other",
];

async function getStructuredDataFromEmail(emailSubject, emailTextBody) {
  if (!emailSubject && !emailTextBody) {
    console.warn(
      "OPENAI_SERVICE: Subject and body are empty. Skipping OpenAI call."
    );
    return null;
  }

  const prompt = `
    You are an expert financial assistant. Your task is to extract structured information from the provided email content.
    Focus on identifying a single primary financial transaction if present (e.g., a purchase, a subscription start/renewal, an invoice payment).

    Email Subject:
    ${emailSubject || "N/A"}

    Email Body (plain text):
    ${emailTextBody || "N/A"}

    Based on the email content, extract the following details for the primary transaction.
    Return the information ONLY in the following JSON format. Do not add any commentary before or after the JSON object.
    If a value cannot be confidently determined from the text, use null for that field.

    JSON Output Format:
    {
      "vendor_name": "string (e.g., 'Netflix', 'Amazon', 'Spotify Inc.') or null",
      "product_name": "string (be specific, e.g., 'Netflix Premium Plan Monthly', 'Echo Dot (5th Gen)', 'Spotify Individual Subscription') or null",
      "price": "number (Extract the primary numeric transaction value, e.g., total amount, final price. This should be a number like 15.99 or 1200.50. Ignore currency symbols like $, €, ₹ here, just the number itself. If there are thousands separators like ',', ensure they are handled to form a valid number like 1200.50 not '1,200.50'. If the item is explicitly stated as 'Free' or has a zero value, return 0. If no specific transaction amount can be found, return null) or null",
      "original_amount": "number (Extract the primary numeric transaction value, e.g., total amount, final price. This should be a number like 15.99 or 1200.50. Ignore currency symbols like $, €, ₹ here, just the number itself. If there are thousands separators like ',', ensure they are handled to form a valid number like 1200.50 not '1,200.50'. If the item is explicitly stated as 'Free' or has a zero value, return 0. If no specific transaction amount can be found, return null) or null",
      "original_currency": "string (3-letter ISO code like USD, EUR, INR, GBP, as seen in the original transaction) or null. If a symbol like $ is used without country context, assume USD. For ₹ or Rs, assume INR. If multiple currencies seem present, pick the one associated with the original_amount.",
      "amount_display: number (the transaction amount converted to USD for display purposes) or null",
      "currency_display": "string (typically 'USD', indicating the currency of amount_display) or null",
      "purchase_date": "string (YYYY-MM-DD format, e.g., 2025-05-31) or null. If multiple dates, pick the primary transaction or order date.",
      "billing_cycle": "string ('one-time', 'monthly', 'annually', 'quarterly') or null",
      "category": "string (choose one from the provided list: [${financialCategories.join(
        ", "
      )}], or 'Other' if none fit well) or null"
    }
    `;

  console.log("OPENAI_SERVICE: Sending prompt to OpenAI...");
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: "You are an expert financial assistant outputting JSON.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      console.error("OPENAI_SERVICE: No content in OpenAI response.");
      return null;
    }

    console.log("OPENAI_SERVICE: Received raw content:", content);
    const structuredData = JSON.parse(content);
    console.log("OPENAI_SERVICE: Parsed structured data:", structuredData);

    if (typeof structuredData.price === "string") {
      structuredData.price = parseFloat(
        structuredData.price.replace(/[^0-9.-]+/g, "")
      );
      if (isNaN(structuredData.price)) structuredData.price = null;
    }
    if (
      structuredData.currency &&
      typeof structuredData.currency === "string"
    ) {
      structuredData.currency = structuredData.currency.toUpperCase();
    } else if (structuredData.price !== null && !structuredData.currency) {
      const bodyPlusSubject =
        (emailTextBody || "") + " " + (emailSubject || "");
      if (
        bodyPlusSubject.includes("₹") ||
        bodyPlusSubject.toLowerCase().includes("inr")
      )
        structuredData.currency = "INR";
      else if (
        bodyPlusSubject.includes("€") ||
        bodyPlusSubject.toLowerCase().includes("eur")
      )
        structuredData.currency = "EUR";
      else if (
        bodyPlusSubject.includes("£") ||
        bodyPlusSubject.toLowerCase().includes("gbp")
      )
        structuredData.currency = "GBP";
      else if (bodyPlusSubject.includes("$")) structuredData.currency = "USD"; // Default $ to USD
    }

    if (
      structuredData.purchase_date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(structuredData.purchase_date)
    ) {
      try {
        const d = new Date(structuredData.purchase_date);
        if (!isNaN(d)) {
          structuredData.purchase_date = `${d.getFullYear()}-${String(
            d.getMonth() + 1
          ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        } else {
          console.warn(
            "OPENAI_SERVICE: Purchase date not in YYYY-MM-DD and could not be re-parsed, setting to null:",
            structuredData.purchase_date
          );
          structuredData.purchase_date = null;
        }
      } catch (e) {
        console.warn(
          "OPENAI_SERVICE: Error re-parsing purchase date, setting to null:",
          structuredData.purchase_date,
          e
        );
        structuredData.purchase_date = null;
      }
    }

    return structuredData;
  } catch (error) {
    console.error(
      "OPENAI_SERVICE: Error calling OpenAI API:",
      error.response ? error.response.data : error.message
    );
    if (error.response && error.response.data && error.response.data.error) {
      console.error(
        "OPENAI_SERVICE: OpenAI API Error Details:",
        error.response.data.error.message
      );
    }
    return null;
  }
}

module.exports = { getStructuredDataFromEmail, financialCategories };
