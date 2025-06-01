// backend/utils/contextExtractor.js
const natural = require("natural");
const sentenceTokenizer = new natural.SentenceTokenizer();
const { KNOWN_SERVICES, CONTEXT_INDICATOR_KEYWORDS } = require("./constants");

// Initialize Sentiment Analyzer (AFINN is a good general-purpose one)
const language = "English";
const stemmer = natural.PorterStemmer; // or LancasterStemmer
const vocabulary = "afinn"; // AFINN provides a score from -5 to 5
const sentimentAnalyzer = new natural.SentimentAnalyzer(
  language,
  stemmer,
  vocabulary
);

function getSentimentLabel(score) {
  if (score > 0.3) return "positive"; // Threshold for positive
  if (score < -0.3) return "negative"; // Threshold for negative
  return "neutral";
}

function extractContextHighlights(
  textBody,
  ownerEmail,
  emailSubject,
  emailMessageID,
  financialItemID,
  productName
) {
  if (!textBody) return [];

  const highlights = [];
  const sentences = sentenceTokenizer.tokenize(textBody);
  let overallProductKeyword = null;

  // Determine overall product keyword for the email
  for (const service of KNOWN_SERVICES) {
    if (
      emailSubject.toLowerCase().includes(service.toLowerCase()) ||
      textBody.toLowerCase().includes(service.toLowerCase())
    ) {
      overallProductKeyword = service;
      break;
    }
  }

  sentences.forEach((sentence) => {
    const lowerSentence = sentence.toLowerCase();
    let sentenceProductKeyword = overallProductKeyword; // Default to overall

    // Refine product keyword if sentence is more specific
    if (!sentenceProductKeyword) {
      for (const service of KNOWN_SERVICES) {
        if (lowerSentence.includes(service.toLowerCase())) {
          sentenceProductKeyword = service;
          break;
        }
      }
    } else {
      let specificProductInSentence = false;
      for (const service of KNOWN_SERVICES) {
        if (lowerSentence.includes(service.toLowerCase())) {
          sentenceProductKeyword = service; // Prefer product mentioned directly in sentence
          specificProductInSentence = true;
          break;
        }
      }
      // If no specific product in sentence, but overall product exists, use that
      if (!specificProductInSentence && overallProductKeyword)
        sentenceProductKeyword = overallProductKeyword;
    }

    let foundIndicator = false;
    for (const indicator of CONTEXT_INDICATOR_KEYWORDS) {
      if (lowerSentence.includes(indicator)) {
        foundIndicator = true;
        break;
      }
    }

    if (
      sentence.trim().length > 15 &&
      sentence.trim().length < 400 &&
      foundIndicator
    ) {
      // Only consider it a highlight if an indicator is present AND (a product is mentioned OR it's a strongly contextual sentence)
      // For simplicity in MVP, let's say if an indicator is found, and there's *some* product context (even overall), it's a highlight.
      if (
        sentenceProductKeyword ||
        CONTEXT_INDICATOR_KEYWORDS.some((ind) => lowerSentence.includes(ind))
      ) {
        const tokenizedSentence = new natural.WordTokenizer().tokenize(
          lowerSentence
        );
        const sentimentScore =
          sentimentAnalyzer.getSentiment(tokenizedSentence);
        const sentiment = getSentimentLabel(sentimentScore);

        highlights.push({
          owner_email: ownerEmail,
          product_keyword: sentenceProductKeyword, // May be null
          highlight_text: sentence.trim(),
          sentiment: sentiment, // Store the sentiment
          source_email_subject: emailSubject,
          source_email_message_id: emailMessageID,
          financial_item_id: financialItemID,
          product_name: productName,
        });
      }
    }
  });

  // Fallback if no specific highlights but a product was mentioned
  if (
    highlights.length === 0 &&
    overallProductKeyword &&
    textBody.length > 50 &&
    textBody.length < 1000
  ) {
    const tokenizedFallback = new natural.WordTokenizer().tokenize(
      textBody.substring(0, 200).toLowerCase()
    );
    const fallbackSentimentScore =
      sentimentAnalyzer.getSentiment(tokenizedFallback);
    const fallbackSentiment = getSentimentLabel(fallbackSentimentScore);
    highlights.push({
      owner_email: ownerEmail,
      product_keyword: overallProductKeyword,
      highlight_text: `General context about ${overallProductKeyword}: ${textBody
        .substring(0, 200)
        .replace(/\s+/g, " ")
        .trim()}...`,
      sentiment: fallbackSentiment,
      source_email_subject: emailSubject,
      source_email_message_id: emailMessageID,
    });
  }
  console.log(
    `CONTEXT_EXTRACTOR: Found ${
      highlights.length
    } highlights for email subject "${emailSubject}" with primary product keyword "${
      overallProductKeyword || "N/A"
    }"`
  );
  return highlights;
}

module.exports = { extractContextHighlights };
