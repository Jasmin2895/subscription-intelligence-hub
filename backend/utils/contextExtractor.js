// backend/utils/contextExtractor.js
const natural = require("natural");
const sentenceTokenizer = new natural.SentenceTokenizer();
const { KNOWN_SERVICES, CONTEXT_INDICATOR_KEYWORDS } = require("./constants"); // Ensure constants.js is correct

// Initialize Sentiment Analyzer
const language = "English";
const stemmer = natural.PorterStemmer;
const vocabulary = "afinn";
const sentimentAnalyzer = new natural.SentimentAnalyzer(
  language,
  stemmer,
  vocabulary
);

function getSentimentLabel(score) {
  if (score > 0.3) return "positive";
  if (score < -0.3) return "negative";
  return "neutral";
}

// MODIFIED SIGNATURE: Removed financialItemID and productName arguments
function extractContextHighlights(
  textBody,
  ownerEmail,
  emailSubject,
  emailMessageID
) {
  console.log(
    `CONTEXT_EXTRACTOR: Starting extraction for Subject: "${emailSubject}", Owner: ${ownerEmail}`
  );
  if (!textBody || typeof textBody !== "string" || textBody.trim() === "") {
    // Added more robust check for textBody
    console.log(
      "CONTEXT_EXTRACTOR: TextBody is empty or invalid. Returning empty highlights."
    );
    return [];
  }

  const highlights = [];
  const sentences = sentenceTokenizer.tokenize(textBody);
  let overallProductKeywordFromEmail = null; // Product keyword identified for the entire email

  // Determine an overall product keyword for the email by checking subject and then body
  const combinedSubjectBodyForOverallKeyword =
    emailSubject.toLowerCase() + " " + textBody.toLowerCase();
  for (const service of KNOWN_SERVICES) {
    if (combinedSubjectBodyForOverallKeyword.includes(service.toLowerCase())) {
      overallProductKeywordFromEmail = service;
      console.log(
        `CONTEXT_EXTRACTOR: Overall product keyword for email identified as: "${overallProductKeywordFromEmail}"`
      );
      break; // Use the first one found as the primary for the email
    }
  }

  sentences.forEach((sentence, index) => {
    const lowerSentence = sentence.toLowerCase();
    let productKeywordForThisHighlight = null; // Keyword specific to this sentence/highlight

    // 1. Try to find a KNOWN_SERVICE mentioned in *this specific sentence*
    for (const service of KNOWN_SERVICES) {
      if (lowerSentence.includes(service.toLowerCase())) {
        productKeywordForThisHighlight = service;
        break;
      }
    }
    // 2. If no specific product in this sentence, but an overall product was identified for the email, use that.
    if (!productKeywordForThisHighlight && overallProductKeywordFromEmail) {
      productKeywordForThisHighlight = overallProductKeywordFromEmail;
    }

    let foundIndicator = false;
    for (const indicator of CONTEXT_INDICATOR_KEYWORDS) {
      if (lowerSentence.includes(indicator)) {
        foundIndicator = true;
        break;
      }
    }

    // Debug log for each sentence considered
    // console.log(`DEBUG_SENTENCE ${index + 1}: "${sentence.substring(0, 50)}..." ProductForSentence: ${productKeywordForThisHighlight}, IndicatorFound: ${foundIndicator}`);

    // A highlight requires an indicator word.
    // It's more valuable if also associated with a product keyword (either sentence-specific or email-overall).
    if (
      sentence.trim().length > 15 && // Basic length filter for meaningfulness
      sentence.trim().length < 400 && // Avoid overly long "sentences"
      foundIndicator // Must contain a context indicator
    ) {
      // If an indicator is found, we create a highlight.
      // The product_keyword will be set if one was identified for the sentence or email.
      const tokenizedSentence = new natural.WordTokenizer().tokenize(
        lowerSentence
      );
      const sentimentScore = sentimentAnalyzer.getSentiment(tokenizedSentence);
      const sentiment = getSentimentLabel(sentimentScore);

      highlights.push({
        owner_email: ownerEmail,
        product_keyword: productKeywordForThisHighlight, // This can be null if no product context found for this specific highlight
        highlight_text: sentence.trim(),
        sentiment: sentiment,
        source_email_subject: emailSubject,
        source_email_message_id: emailMessageID,
        // financial_item_id is NOT set here; linking is done in server.js
      });
      // console.log(`  -> ADDED HIGHLIGHT: Text: "${sentence.trim()}", Product: ${productKeywordForThisHighlight || 'N/A'}, Sentiment: ${sentiment}`);
    }
  });

  // Fallback: If absolutely no indicator-based highlights were found,
  // but an overall product for the email was identified, and the email body is substantial,
  // create one general context highlight for that product.
  if (
    highlights.length === 0 &&
    overallProductKeywordFromEmail &&
    textBody.length > 50 &&
    textBody.length < 2000 // Limit fallback body length
  ) {
    const fallbackText = `General discussion regarding ${overallProductKeywordFromEmail}: ${textBody
      .substring(0, 250) // Take a snippet
      .replace(/\s+/g, " ")
      .trim()}...`;
    const tokenizedFallback = new natural.WordTokenizer().tokenize(
      fallbackText.toLowerCase()
    );
    const fallbackSentimentScore =
      sentimentAnalyzer.getSentiment(tokenizedFallback);
    const fallbackSentiment = getSentimentLabel(fallbackSentimentScore);

    highlights.push({
      owner_email: ownerEmail,
      product_keyword: overallProductKeywordFromEmail,
      highlight_text: fallbackText,
      sentiment: fallbackSentiment,
      source_email_subject: emailSubject,
      source_email_message_id: emailMessageID,
    });
    console.log(
      `CONTEXT_EXTRACTOR: Added fallback highlight for product "${overallProductKeywordFromEmail}" as no specific highlights were found.`
    );
  }

  console.log(
    `CONTEXT_EXTRACTOR: Finished. Found ${highlights.length} total highlights for subject "${emailSubject}".`
  );
  return highlights;
}

module.exports = { extractContextHighlights };
