// frontend/src/App.js
import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import EmailEntryPage from "./components/EmailEntryPage";
import DashboardPage from "./components/DashboardPage";
import "./App.css"; // We'll create this next

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<EmailEntryPage />} />
        <Route path="/dashboard/:userEmail" element={<DashboardPage />} />{" "}
        {/* Route with URL parameter */}
        <Route path="*" element={<Navigate to="/" />} />{" "}
        {/* Redirect any unknown paths to the entry page */}
      </Routes>
    </Router>
  );
}

export default App;
