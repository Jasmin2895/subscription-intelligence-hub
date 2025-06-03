// frontend/src/components/EmailEntryPage.js
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

function EmailEntryPage() {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  // !!! REPLACE THIS with the actual email address your backend is configured to receive on !!!
  // This should match FULL_APP_RECEIVING_EMAIL from your backend/server.js
  const appReceivingEmail = "hub@YOUR_UNIQUE_ID.inbound.postmarkapp.com";

  const handleSubmit = (e) => {
    e.preventDefault();
    if (email.trim()) {
      navigate(`/dashboard/${encodeURIComponent(email.trim().toLowerCase())}`);
    }
  };

  return (
    <div className="container entry-page">
      <h1>Subscription & Purchase Intelligence Hub</h1>
      <p>
        Enter your email address (the one you forward FROM) to view your
        personalized dashboard.
      </p>
      <form onSubmit={handleSubmit} className="entry-form">
        <div>
          <label htmlFor="userEmail">Your Email Address:</label>
          <input
            type="email"
            id="userEmail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>
        <button type="submit">View My Hub</button>
      </form>
      <div className="instructions">
        <h4>How to Use This Hub:</h4>
        <p>
          Forward your financial receipts and relevant discussion emails to the
          following dedicated Hub address:
        </p>
        <p className="email-address">
          <strong>postmtest06@gmail.com</strong>
        </p>
        <p>
          <small>
            Your Hub will then intelligently process them and link relevant
            context!
          </small>
        </p>
      </div>
    </div>
  );
}
export default EmailEntryPage;
