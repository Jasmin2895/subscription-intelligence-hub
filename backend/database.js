// backend/database.js
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");

// Connection Pool: Reads connection details from environment variables
const pool = new Pool();

pool.on("connect", () => {
  console.log("DB_LOG: Connected to the PostgreSQL database.");
});

pool.on("error", (err) => {
  console.error("DB_ERROR: Unexpected error on idle client", err);
  process.exit(-1); // Consider a more graceful shutdown or error handling for production
});

async function initializeDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FinancialItems Table - MODIFIED to include category
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
        category TEXT,          -- ADDED CATEGORY COLUMN HERE
        raw_email_subject TEXT,
        source_email_message_id TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log(
      "DB_LOG: FinancialItems table checked/created in PostgreSQL (with category)."
    );

    // ContextHighlights Table (ensure schema is as needed, e.g., with sentiment if you added that)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ContextHighlights (
        id UUID PRIMARY KEY,
        owner_email TEXT NOT NULL,
        financial_item_id UUID,
        product_keyword TEXT,
        highlight_text TEXT NOT NULL,
        sentiment TEXT, -- Assuming you added sentiment based on previous discussions
        source_email_subject TEXT,
        source_email_message_id TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (financial_item_id) REFERENCES FinancialItems(id) ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    console.log(
      "DB_LOG: ContextHighlights table checked/created in PostgreSQL."
    );

    // Add new columns to FinancialItems if they don't exist
    const columnsToAdd = [
      { name: "original_amount", type: "REAL" },
      { name: "original_currency", type: "TEXT" },
      { name: "amount_display", type: "REAL" },
      { name: "currency_display", type: "TEXT" },
      { name: "category", type: "TEXT" }, // ADD category to the ALTER TABLE check for robustness
    ];

    for (const col of columnsToAdd) {
      const checkColExists = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='financialitems' AND column_name=$1",
        [col.name.toLowerCase()]
      );
      if (checkColExists.rowCount === 0) {
        await client.query(
          `ALTER TABLE FinancialItems ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}` // Added IF NOT EXISTS
        );
        console.log(
          `DB_LOG: Added column ${col.name} to FinancialItems table.`
        );
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(
      "DB_ERROR: Error initializing PostgreSQL database tables:",
      e
    );
    // For a hackathon, re-throwing might stop the app, which is fine for alerting to setup issues.
    // For production, you might handle this more gracefully.
    throw e;
  } finally {
    client.release();
  }
}

// Initialize DB on startup
pool
  .connect()
  .then((client) => {
    client.release();
    return initializeDb();
  })
  .catch((err) =>
    console.error(
      "DB_ERROR: Failed to initialize PostgreSQL database on startup:",
      err
    )
  );

const addFinancialItem = async (item) => {
  // Destructure all fields including category
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
    category, // Ensure category is destructured
    raw_email_subject,
    source_email_message_id,
  } = item;

  // MODIFIED SQL to include category and correct number of placeholders
  const sql = `
    INSERT INTO FinancialItems (
      id, owner_email, vendor_name, product_name, 
      original_amount, original_currency, amount_display, currency_display,
      purchase_date, billing_cycle, category, raw_email_subject, source_email_message_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
    RETURNING *; 
  `;

  // MODIFIED values array to include category
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
    category, // Added category here
    raw_email_subject,
    source_email_message_id,
  ];

  try {
    const res = await pool.query(sql, values);
    console.log("DB_LOG: FinancialItem added/updated:", res.rows[0]?.id);
    return res.rows[0];
  } catch (err) {
    console.error(
      "DB_ERROR: Error in addFinancialItem:",
      err.message,
      "Input item:",
      item
    );
    if (
      err.code === "23505" && // PostgreSQL unique violation code
      err.constraint &&
      err.constraint.toLowerCase().includes("source_email_message_id") // Check constraint name flexibly
    ) {
      const newError = new Error( // Recreate error to match expected structure if needed elsewhere
        `UNIQUE constraint failed: FinancialItems.source_email_message_id for value ${source_email_message_id}`
      );
      newError.code = "SQLITE_CONSTRAINT_UNIQUE"; // Mimic SQLite if server.js has specific catch for this
      throw newError;
    }
    throw err;
  }
};

// getFinancialItemsByOwner uses SELECT *, so it will automatically pick up the new category column
const getFinancialItemsByOwner = async (owner_email) => {
  const sql =
    "SELECT * FROM FinancialItems WHERE owner_email = $1 ORDER BY purchase_date DESC, created_at DESC"; // Ordered by purchase_date
  try {
    const res = await pool.query(sql, [owner_email]);
    return res.rows;
  } catch (err) {
    console.error("DB_ERROR: Error in getFinancialItemsByOwner:", err.message);
    throw err;
  }
};

// findFinancialItemByKeywordAndOwner uses SELECT *, so it will also pick up category
const findFinancialItemByKeywordAndOwner = async (keyword, owner_email) => {
  const sql = `
    SELECT * FROM FinancialItems 
    WHERE owner_email = $1 
      AND (vendor_name ILIKE $2 OR product_name ILIKE $2 OR raw_email_subject ILIKE $2 OR category ILIKE $2) -- Added category to search
    ORDER BY purchase_date DESC, created_at DESC LIMIT 1`; // Ordered by purchase_date
  try {
    const res = await pool.query(sql, [owner_email, `%${keyword}%`]);
    return res.rows[0] || null;
  } catch (err) {
    console.error(
      "DB_ERROR: Error in findFinancialItemByKeywordAndOwner:",
      err.message
    );
    throw err;
  }
};

// ContextHighlights functions - ensure these are complete from previous versions
// Make sure addContextHighlight includes 'sentiment' if you added that to the table
const addContextHighlight = async (highlight) => {
  const {
    id = uuidv4(),
    owner_email,
    financial_item_id,
    product_keyword,
    highlight_text,
    sentiment, // Assuming sentiment is passed in 'highlight' object
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
    sentiment, // Added sentiment
    source_email_subject,
    source_email_message_id,
  ];

  try {
    const res = await pool.query(sql, values);
    return res.rows[0];
  } catch (err) {
    console.error(
      "DB_ERROR: Error in addContextHighlight:",
      err.message,
      "Input highlight:",
      highlight
    );
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
    console.error(
      "DB_ERROR: Error in getContextHighlightsForItem:",
      err.message
    );
    throw err;
  }
};

const getContextHighlightsByProductKeywordAndOwner = async (
  product_keyword,
  owner_email
) => {
  const sql = `
    SELECT * FROM ContextHighlights 
    WHERE owner_email = $1 AND product_keyword ILIKE $2 AND financial_item_id IS NULL
    ORDER BY created_at DESC
  `;
  try {
    const res = await pool.query(sql, [owner_email, `%${product_keyword}%`]);
    return res.rows;
  } catch (err) {
    console.error(
      "DB_ERROR: Error in getContextHighlightsByProductKeywordAndOwner:",
      err.message
    );
    throw err;
  }
};

module.exports = {
  initializeDb,
  addFinancialItem,
  getFinancialItemsByOwner,
  findFinancialItemByKeywordAndOwner,
  addContextHighlight,
  getContextHighlightsForItem,
  getContextHighlightsByProductKeywordAndOwner,
};
