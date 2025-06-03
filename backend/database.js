// backend/database.js
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");

// --- Pool Configuration with SSL for Heroku ---
let poolConfig = {};

if (process.env.DATABASE_URL) {
  // If DATABASE_URL is present (common for Heroku and other cloud providers)
  poolConfig.connectionString = process.env.DATABASE_URL;
  // For Heroku Postgres and many other cloud providers, SSL is required,
  // and you often need to allow unauthorized CAs (Heroku uses self-signed certs internally)
  if (process.env.NODE_ENV === "production") {
    // Apply SSL settings typically for production/Heroku
    poolConfig.ssl = { rejectUnauthorized: false };
    console.log(
      "DB_LOG: SSL configured for production (rejectUnauthorized: false)."
    );
  } else {
    if (process.env.DATABASE_URL.includes("sslmode=require")) {
      poolConfig.ssl = { rejectUnauthorized: false }; // Also apply if DATABASE_URL explicitly requires it
      console.log(
        "DB_LOG: SSL configured based on DATABASE_URL (rejectUnauthorized: false)."
      );
    } else {
      console.log(
        "DB_LOG: SSL not explicitly configured for non-production or DATABASE_URL doesn't require it."
      );
    }
  }
} else {
  // Fallback to individual environment variables if DATABASE_URL is not set (typical for some local setups)
  console.log(
    "DB_LOG: DATABASE_URL not found, using individual PG environment variables."
  );
  poolConfig = {
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT || "5432"),
    // Add SSL here too if your local setup that uses these vars needs it
    // ssl: { rejectUnauthorized: false } // Example if needed locally
  };
}

const pool = new Pool(poolConfig);

pool.on("connect", (client) => {
  // client argument is provided on 'connect'
  console.log("DB_LOG: Client connected to the PostgreSQL database via pool.");
  // You could potentially log client.ssl here if curious, though it's after connection.
  // console.log("DB_LOG: Connection SSL status:", client.ssl ? "SSL/TLS" : "No SSL/TLS");
});

pool.on("error", (err, client) => {
  // client argument is also provided on 'error'
  console.error("DB_ERROR: Unexpected error on idle client in pool", err);
  // Consider if process.exit(-1) is appropriate for all pool errors.
  // It might be better to log and let individual queries handle their errors.
});

// --- initializeDb function (ensure it includes category and sentiment as per Turn 61/63) ---
async function initializeDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FinancialItems Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS FinancialItems (
        id UUID PRIMARY KEY,
        owner_email TEXT NOT NULL,
        vendor_name TEXT,
        product_name TEXT,
        original_amount REAL,
        original_currency TEXT,
        amount_display REAL,    
        currency_display TEXT,  
        purchase_date TEXT,
        billing_cycle TEXT,
        category TEXT,          
        raw_email_subject TEXT,
        source_email_message_id TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("DB_LOG: FinancialItems table checked/created.");

    // ContextHighlights Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ContextHighlights (
        id UUID PRIMARY KEY,
        owner_email TEXT NOT NULL,
        financial_item_id UUID,
        product_keyword TEXT,
        highlight_text TEXT NOT NULL,
        sentiment TEXT, -- Added for sentiment analysis
        source_email_subject TEXT,
        source_email_message_id TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (financial_item_id) REFERENCES FinancialItems(id) ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    console.log("DB_LOG: ContextHighlights table checked/created.");

    // Add new columns logic (as in your provided code, ensure 'category' and 'sentiment' are covered if needed for ALTER)
    const columnsToAddFinancial = [
      { name: "original_amount", type: "REAL" },
      { name: "original_currency", type: "TEXT" },
      { name: "amount_display", type: "REAL" },
      { name: "currency_display", type: "TEXT" },
      { name: "category", type: "TEXT" },
    ];
    for (const col of columnsToAddFinancial) {
      const checkColExists = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='financialitems' AND column_name=$1",
        [col.name.toLowerCase()]
      );
      if (checkColExists.rowCount === 0) {
        await client.query(
          `ALTER TABLE FinancialItems ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
        );
        console.log(
          `DB_LOG: Added column ${col.name} to FinancialItems table.`
        );
      }
    }
    // Add sentiment to ContextHighlights if it might be missing from an old schema
    const checkSentimentCol = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='contexthighlights' AND column_name='sentiment'"
    );
    if (checkSentimentCol.rowCount === 0) {
      await client.query(
        `ALTER TABLE ContextHighlights ADD COLUMN IF NOT EXISTS sentiment TEXT`
      );
      console.log(`DB_LOG: Added column sentiment to ContextHighlights table.`);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("DB_ERROR: Error initializing tables:", e);
    throw e;
  } finally {
    client.release();
  }
}

// Initialize DB on startup (ensure this doesn't block app start on error if pool is unavailable)
// The initial pool.connect() is just a quick check, initializeDb does more.
// It might be better to call initializeDb without the preceding pool.connect() if initializeDb handles its own client.
// Or ensure errors here are handled gracefully.
(async () => {
  try {
    await initializeDb();
    console.log(
      "DB_LOG: Database initialization sequence completed (or tables already exist)."
    );
  } catch (err) {
    console.error(
      "DB_ERROR: Critical failure during initial database setup:",
      err
    );
    // process.exit(1); // Exit if DB init is critical for app start
  }
})();

// --- Database Functions (addFinancialItem, getFinancialItemsByOwner, etc.) ---
// Your existing functions (addFinancialItem, getFinancialItemsByOwner, findFinancialItemByKeywordAndOwner,
// addContextHighlight, getContextHighlightsForItem, getContextHighlightsByProductKeywordAndOwner)
// from Turn 63 are generally fine for their SQL logic, provided they use 'await pool.query(...)'
// and handle destructuring of 'item' and 'highlight' objects correctly.
// Ensure 'category' is in addFinancialItem and 'sentiment' is in addContextHighlight.

// Example: addFinancialItem (ensure it matches your latest version from Turn 63)
const addFinancialItem = async (item) => {
  const {
    id = uuidv4(),
    owner_email,
    vendor_name,
    product_name,
    original_amount,
    original_currency,
    amount_display,
    currency_display,
    purchase_date,
    billing_cycle,
    category, // Category is included
    raw_email_subject,
    source_email_message_id,
  } = item;

  const sql = `
    INSERT INTO FinancialItems (
      id, owner_email, vendor_name, product_name, 
      original_amount, original_currency, amount_display, currency_display,
      purchase_date, billing_cycle, category, raw_email_subject, source_email_message_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
    RETURNING *; 
  `;
  const values = [
    id,
    owner_email,
    vendor_name,
    product_name,
    original_amount,
    original_currency,
    amount_display,
    currency_display,
    purchase_date,
    billing_cycle,
    category, // Category included
    raw_email_subject,
    source_email_message_id,
  ];

  try {
    const res = await pool.query(sql, values);
    console.log("DB_LOG: FinancialItem added:", res.rows[0]?.id);
    return res.rows[0];
  } catch (err) {
    /* ... (your error handling from Turn 63) ... */
    console.error("DB_ERROR: Error in addFinancialItem:", err.message);
    if (
      err.code === "23505" &&
      err.constraint &&
      err.constraint.toLowerCase().includes("source_email_message_id")
    ) {
      const newError = new Error(
        `UNIQUE constraint failed: FinancialItems.source_email_message_id for value ${source_email_message_id}`
      );
      newError.code = "PG_UNIQUE_VIOLATION"; // Or use err.code directly
      throw newError;
    }
    throw err;
  }
};

// addContextHighlight (ensure 'sentiment' is included if your schema has it)
const addContextHighlight = async (highlight) => {
  const {
    id = uuidv4(),
    owner_email,
    financial_item_id,
    product_keyword,
    highlight_text,
    sentiment, // Sentiment included
    source_email_subject,
    source_email_message_id,
  } = highlight;

  const sql = `
    INSERT INTO ContextHighlights (
      id, owner_email, financial_item_id, product_keyword, 
      highlight_text, sentiment, source_email_subject, source_email_message_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;
  const values = [
    id,
    owner_email,
    financial_item_id,
    product_keyword,
    highlight_text,
    sentiment, // Sentiment included
    source_email_subject,
    source_email_message_id,
  ];
  try {
    const res = await pool.query(sql, values);
    return res.rows[0];
  } catch (err) {
    /* ... (your error handling from Turn 63) ... */
    console.error("DB_ERROR: Error in addContextHighlight:", err.message);
    throw err;
  }
};

// --- EXPORT THE REST OF YOUR DB FUNCTIONS AS BEFORE ---
// getFinancialItemsByOwner, findFinancialItemByKeywordAndOwner,
// getContextHighlightsForItem, getContextHighlightsByProductKeywordAndOwner
// (The versions from Turn 63 for these should be fine as they use SELECT *)

const getFinancialItemsByOwner = async (owner_email) => {
  const sql =
    "SELECT * FROM FinancialItems WHERE owner_email = $1 ORDER BY purchase_date DESC, created_at DESC";
  try {
    const res = await pool.query(sql, [owner_email]);
    return res.rows;
  } catch (err) {
    console.error("DB_ERROR: getFinancialItemsByOwner:", err.message);
    throw err;
  }
};

const findFinancialItemByKeywordAndOwner = async (keyword, owner_email) => {
  const sql = `SELECT * FROM FinancialItems WHERE owner_email = $1 AND (vendor_name ILIKE $2 OR product_name ILIKE $2 OR raw_email_subject ILIKE $2 OR category ILIKE $2) ORDER BY purchase_date DESC, created_at DESC LIMIT 1`;
  try {
    const res = await pool.query(sql, [owner_email, `%${keyword}%`]);
    return res.rows[0] || null;
  } catch (err) {
    console.error("DB_ERROR: findFinancialItemByKeywordAndOwner:", err.message);
    throw err;
  }
};

const getContextHighlightsForItem = async (financial_item_id) => {
  const sql =
    "SELECT * FROM ContextHighlights WHERE financial_item_id = $1 ORDER BY created_at DESC";
  try {
    const res = await pool.query(sql, [financial_item_id]);
    return res.rows;
  } catch (err) {
    console.error("DB_ERROR: getContextHighlightsForItem:", err.message);
    throw err;
  }
};

const getContextHighlightsByProductKeywordAndOwner = async (
  product_keyword,
  owner_email
) => {
  const sql = `SELECT * FROM ContextHighlights WHERE owner_email = $1 AND product_keyword ILIKE $2 AND financial_item_id IS NULL ORDER BY created_at DESC`;
  try {
    const res = await pool.query(sql, [owner_email, `%${product_keyword}%`]);
    return res.rows;
  } catch (err) {
    console.error(
      "DB_ERROR: getContextHighlightsByProductKeywordAndOwner:",
      err.message
    );
    throw err;
  }
};

module.exports = {
  initializeDb, // Good to export if you want to run it manually for setup/reset scripts
  addFinancialItem,
  getFinancialItemsByOwner,
  findFinancialItemByKeywordAndOwner,
  addContextHighlight,
  getContextHighlightsForItem,
  getContextHighlightsByProductKeywordAndOwner,
};
