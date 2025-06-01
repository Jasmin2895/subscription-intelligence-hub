import React from "react";
import { useLocation, Link } from "react-router-dom";

// !! IMPORTANT: This is for DISPLAY PURPOSES in the instructions.
// It should reflect the domain your backend uses to construct the email addresses.
// Example: "myuniqueid.inbound.postmarkapp.com" or "parse.yourcustomdomain.com"
const POSTMARK_INBOUND_DOMAIN_DISPLAY = "yoursubdomain.inbound.postmarkapp.com"; // CHANGE THIS!

function ShowAddress() {
  const location = useLocation();
  const userData = location.state?.userData;

  if (!userData || !userData.email || !userData.unique_postmark_address) {
    return (
      <div className="container">
        <h1>Error</h1>
        <p>User data is missing or incomplete. Please try signing up again.</p>
        <Link to="/" className="link-button">
          Go to Signup
        </Link>
      </div>
    );
  }

  // For display in instructions, derive from the actual address if possible,
  // or fall back to the constant.
  let displayDomain = POSTMARK_INBOUND_DOMAIN_DISPLAY;
  try {
    displayDomain = userData.unique_postmark_address.split("@")[1];
  } catch (e) {
    console.warn(
      "Could not parse domain from unique_postmark_address for display"
    );
  }

  return (
    <div className="container">
      <h1>Success! Here's Your Dedicated Hub Address</h1>
      <p>
        Welcome, <strong>{userData.email}</strong>!
      </p>
      <p>
        Forward your financial emails (receipts, subscriptions) and relevant
        discussion emails to the address below:
      </p>
      <p className="email-address">{userData.unique_postmark_address}</p>

      <div className="instructions">
        <h4>Next Steps:</h4>
        <ol>
          <li>
            <strong>Configure Postmark Inbound Webhook:</strong>
            <p>
              Ensure Postmark is set up to forward emails sent to addresses like{" "}
              <code>*@{displayDomain}</code> to your application's webhook
              endpoint.
            </p>
            <p>
              If developing locally, your webhook URL (using ngrok) would look
              like: <br />
              <code>
                https://&lt;your-ngrok-id&gt;.ngrok.io/webhook/email-inbound
              </code>
            </p>
            <p>
              If deployed, it would be: <br />
              <code>
                https://&lt;your-deployed-app-url&gt;/webhook/email-inbound
              </code>
            </p>
          </li>
          <li>
            <strong>Start Forwarding:</strong> Send a test email (e.g., a mock
            receipt or a simple message) from your personal email account to:{" "}
            <br />
            <code>{userData.unique_postmark_address}</code>
          </li>
          <li>
            Check your Node.js backend console for logs indicating the email was
            received.
          </li>
          <li>
            Later, these items will appear on your dashboard (once that feature
            is built).
          </li>
        </ol>
      </div>
      <Link to="/" className="link-button">
        Sign Up Another Email
      </Link>
    </div>
  );
}

export default ShowAddress;
