# Subscription & Purchase Intelligence Hub 🧠💸

**Submitted for the Postmark Challenge: Inbox Innovators!**

Tired of sifting through emails to find out how much you're spending on subscriptions or why you made a particular purchase? The Subscription & Purchase Intelligence Hub transforms your email inbox into a smart financial command center!

This application automatically parses your forwarded e-receipts and relevant discussion emails, extracts key financial data using AI, identifies contextual insights (like reasons for purchase, issues, or sentiment from discussions), and links them together. View your consolidated financial intelligence on a personalized dashboard and get smart updates via Slack.

## ✨ Key Features

- **AI-Powered Financial Parsing:** Uses OpenAI (GPT models) to accurately extract vendor names, product details, prices, currencies, dates, billing cycles, and categories from a wide variety of financial emails.
- **Contextual Intelligence Engine:**
  - Identifies and extracts "Automated Context Highlights" from discussion emails using NLP (`natural` library).
  - Performs **Sentiment Analysis** on context highlights (positive, negative, neutral) to provide deeper understanding.
  - Automatically links relevant context and discussion insights to your financial items.
- **No User Accounts Needed (Implicit User ID):** Simply forward your emails! The system uses your forwarding email address (`owner_email`) to organize and display _your_ data.
- **Personalized Web Dashboard (React):**
  - Enter your `owner_email` to view your private financial hub.
  - Displays a clear list of financial items with their original and USD-converted amounts.
  - Showcases linked "Context Highlights" alongside each financial item, complete with sentiment indicators (e.g., 👍👎😐).
  - (Implemented/Planned) "Upcoming Renewals" section.
  - (Implemented/Planned) Basic charts for spending overview.
- **Smart Slack Notifications:** Receive timely updates in a designated Slack channel when new financial items are processed and linked with insightful context, including sentiment.
- **Calendar Integration (.ics Export):** Download `.ics` files for your subscription renewals directly from the dashboard to add them to your preferred calendar.
- **Currency Conversion:** Automatically converts amounts from original currencies (e.g., INR, EUR, GBP) to a display amount in USD.

## 🚀 Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Email Inbound Processing:** Postmark (via Inbound Webhook)
- **AI for Financial Parsing:** OpenAI API (e.g., GPT-3.5-turbo, GPT-4)
- **NLP for Context Extraction:** `natural` library (Node.js)
- **Frontend:** React, React Router, Axios
  - **Charting:** Recharts
- **Real-time Local Development Tunneling:** `ngrok`
- **Notifications:** Slack (via Incoming Webhooks)
- **Calendar Export:** `ics` library (Node.js)

## 🛠️ Setup & Installation (Local Development)

Follow these steps to get the project running locally:

**Prerequisites:**

- Node.js (v16+ recommended) & npm
- PostgreSQL installed and running
- `ngrok` installed (for exposing your local webhook to Postmark)
- A Postmark Account (with a configured Server for inbound email)
- An OpenAI API Key
- A Slack Workspace and an Incoming Webhook URL for a channel

**1. Clone the Repository (if applicable):**

```bash
git clone <repo-url>
```

**2. Install Dependencies:**

```bash
cd subscription-intelligence-hub
npm install
```

**3. Set Up Environment Variables:**

Switch to the `subscription-intelligence-hub` directory and then change the directory to `server` and create a `.env` file with the content from `.env.example`.

```bash
cd server
cp .env.example .env
```

**4. Start the Server:**

```bash
npm run dev
```

**5. Expose Your Local Server to Postmark:**

```bash
ngrok http 3000
```

Copy the `ngrok` URL provided and update your Postmark Server's Inbound Webhook settings to point to this URL.

**6. Start the Client:**

```bash
cd ../client
npm start
```

**7. Forward Emails:**

Forward your financial emails to the email address associated with your Postmark Server. The system will automatically process and display them on your dashboard.
