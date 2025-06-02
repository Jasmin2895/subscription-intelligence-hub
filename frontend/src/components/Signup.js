import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

// Ensure this URL matches your Node.js backend's address and port
const API_URL = process.env.REACT_APP_API_URL;

function Signup() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    if (!email.trim()) {
      setError("Email is required.");
      setIsLoading(false);
      return;
    }

    try {
      // API call to the Node.js backend
      const response = await axios.post(`${API_URL}/api/signup`, { email });
      // Pass user data to the ShowAddress component via route state
      navigate("/show-address", { state: { userData: response.data } });
    } catch (err) {
      console.error(
        "Signup error:",
        err.response ? err.response.data : err.message
      );
      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError("Failed to sign up. Please check the console and try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Welcome to Brainstormer Hub!</h1>
      <p>
        Enter your email to get started and receive your unique forwarding
        address.
      </p>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Your Email:</label>
          <input
            type="email"
            id="email"
            name="email" // Good practice for forms
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            disabled={isLoading}
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" disabled={isLoading}>
          {isLoading ? "Processing..." : "Get My Hub Address"}
        </button>
      </form>
    </div>
  );
}

export default Signup;
