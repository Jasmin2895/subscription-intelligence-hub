const natural = require("natural");
const sentenceTokenizer = new natural.SentenceTokenizer();
const { KNOWN_SERVICES, CONTEXT_INDICATOR_KEYWORDS } = require("./constants"); // Ensure constants.js is correct

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
    console.log(
      "CONTEXT_EXTRACTOR: TextBody is empty or invalid. Returning empty highlights."
    );
    return [];
  }

  const highlights = [];
  const sentences = sentenceTokenizer.tokenize(textBody);
  let overallProductKeywordFromEmail = null;

  const combinedSubjectBodyForOverallKeyword =
    emailSubject.toLowerCase() + " " + textBody.toLowerCase();
  for (const service of KNOWN_SERVICES) {
    if (combinedSubjectBodyForOverallKeyword.includes(service.toLowerCase())) {
      overallProductKeywordFromEmail = service;
      console.log(
        `CONTEXT_EXTRACTOR: Overall product keyword for email identified as: "${overallProductKeywordFromEmail}"`
      );
      break;
    }
  }

  sentences.forEach((sentence, index) => {
    const lowerSentence = sentence.toLowerCase();
    let productKeywordForThisHighlight = null;

    for (const service of KNOWN_SERVICES) {
      if (lowerSentence.includes(service.toLowerCase())) {
        productKeywordForThisHighlight = service;
        break;
      }
    }
    if (!productKeywordForThisHighlight && overallProductKeywordFromEmail) {
      productKeywordForThisHighlight = overallProductKeywordFromEmail;
    }

    let matchedIndicator = null;
    for (const indicator of CONTEXT_INDICATOR_KEYWORDS) {
      if (lowerSentence.includes(indicator)) {
        matchedIndicator = indicator;
        break;
      }
    }

    if (
      sentence.trim().length > 15 &&
      sentence.trim().length < 400 &&
      matchedIndicator
    ) {
      const tokenizedSentence = new natural.WordTokenizer().tokenize(
        lowerSentence
      );
      const sentimentScore = sentimentAnalyzer.getSentiment(tokenizedSentence);
      const sentiment = getSentimentLabel(sentimentScore);

      const cleanedHighlightText = sentence.trim().replace(/^>\s*/, "");

      highlights.push({
        owner_email: ownerEmail,
        product_keyword: productKeywordForThisHighlight,
        highlight_text: cleanedHighlightText,
        indicator_keyword: matchedIndicator,
        sentiment: sentiment,
        source_email_subject: emailSubject,
        source_email_message_id: emailMessageID,
      });
    }
  });

  if (
    highlights.length === 0 &&
    overallProductKeywordFromEmail &&
    textBody.length > 50 &&
    textBody.length < 2000
  ) {
    const fallbackText = `General discussion regarding ${overallProductKeywordFromEmail}: ${textBody
      .substring(0, 300)
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
      indicator_keyword: "fallback_summary",
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
