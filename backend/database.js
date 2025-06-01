// backend/database.js
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");

// Connection Pool: Reads connection details from environment variables
// PGUSER, PGHOST, PGDATABASE, PGPASSWORD, PGPORT
const pool = new Pool();

pool.on("connect", () => {
  console.log("Connected to the PostgreSQL database.");
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

async function initializeDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FinancialItems Table
    // Note: Using TEXT for id (UUID), REAL for price, TEXT for dates from Postmark (can be parsed later)
    // source_email_message_id should be unique per owner_email, not globally if different users can receive same message ID
    // For simplicity here, making it UNIQUE globally. Consider composite unique constraint if needed.
    await client.query(`
      CREATE TABLE IF NOT EXISTS FinancialItems (
        id UUID PRIMARY KEY,
        owner_email TEXT NOT NULL,
        vendor_name TEXT,
        product_name TEXT,
        original_amount REAL, -- Renamed from 'price' to match server.js
        original_currency TEXT, -- Renamed from 'currency'
        amount_display REAL,    -- Added to store USD converted amount
        currency_display TEXT,  -- Added to store 'USD'
        purchase_date TEXT,
        billing_cycle TEXT,
        raw_email_subject TEXT,
        source_email_message_id TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("FinancialItems table checked/created in PostgreSQL.");

    // ContextHighlights Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ContextHighlights (
        id UUID PRIMARY KEY,
        owner_email TEXT NOT NULL,
        financial_item_id UUID,
        product_keyword TEXT,
        highlight_text TEXT NOT NULL,
        source_email_subject TEXT,
        source_email_message_id TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (financial_item_id) REFERENCES FinancialItems(id) ON DELETE CASCADE
      );
    `);
    console.log("ContextHighlights table checked/created in PostgreSQL.");

    // Add new columns to FinancialItems if they don't exist (for smoother transition if table already exists)
    // These are the fields that were added in server.js parsing logic
    const columnsToAdd = [
      { name: "original_amount", type: "REAL" },
      { name: "original_currency", type: "TEXT" },
      { name: "amount_display", type: "REAL" },
      { name: "currency_display", type: "TEXT" },
    ];

    for (const col of columnsToAdd) {
      const checkColExists = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='financialitems' AND column_name=$1",
        [col.name.toLowerCase()] // Column names are lowercase in information_schema
      );
      if (checkColExists.rowCount === 0) {
        await client.query(
          `ALTER TABLE FinancialItems ADD COLUMN ${col.name} ${col.type}`
        );
        console.log(`Added column ${col.name} to FinancialItems table.`);
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error initializing PostgreSQL database tables:", e);
    throw e; // Re-throw to indicate initialization failure
  } finally {
    client.release();
  }
}

// Call initializeDb when the module loads and on successful pool connection
// This ensures tables are checked/created when the app starts.
pool
  .connect()
  .then((client) => {
    client.release(); // Release the client obtained for the initial connection test
    return initializeDb();
  })
  .catch((err) =>
    console.error("Failed to initialize PostgreSQL database on startup:", err)
  );

const addFinancialItem = async (item) => {
  const {
    id = uuidv4(), // Generate UUID if not provided
    owner_email,
    vendor_name,
    product_name,
    original_amount, // Ensure these match the new schema
    original_currency,
    amount_display,
    currency_display,
    purchase_date,
    billing_cycle,
    raw_email_subject,
    source_email_message_id,
  } = item;

  // The 'price' and 'currency' fields from old schema are now original_amount and original_currency
  const sql = `
    INSERT INTO FinancialItems (
      id, owner_email, vendor_name, product_name, 
      original_amount, original_currency, amount_display, currency_display,
      purchase_date, billing_cycle, raw_email_subject, source_email_message_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *; 
  `; // RETURNING * gets the inserted row back

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
    raw_email_subject,
    source_email_message_id,
  ];

  try {
    const res = await pool.query(sql, values);
    return res.rows[0]; // pg driver returns results in res.rows
  } catch (err) {
    console.error("PostgreSQL: Error in addFinancialItem:", err.message);
    // Handle unique constraint violation for source_email_message_id
    // Adjust constraint name if different. Default is usually financialitems_source_email_message_id_key
    if (
      err.code === "23505" &&
      err.constraint &&
      err.constraint.startsWith("financialitems_source_email_message_id")
    ) {
      const newError = new Error(
        `UNIQUE constraint failed: FinancialItems.source_email_message_id for value ${source_email_message_id}`
      );
      newError.code = "SQLITE_CONSTRAINT_UNIQUE"; // Mimic SQLite error code if server.js expects it
      throw newError;
    }
    throw err;
  }
};

const getFinancialItemsByOwner = async (owner_email) => {
  const sql =
    "SELECT * FROM FinancialItems WHERE owner_email = $1 ORDER BY created_at DESC";
  try {
    const res = await pool.query(sql, [owner_email]);
    return res.rows;
  } catch (err) {
    console.error(
      "PostgreSQL: Error in getFinancialItemsByOwner:",
      err.message
    );
    throw err;
  }
};

const findFinancialItemByKeywordAndOwner = async (keyword, owner_email) => {
  // Using ILIKE for case-insensitive search in PostgreSQL
  const sql = `
    SELECT * FROM FinancialItems 
    WHERE owner_email = $1 
      AND (vendor_name ILIKE $2 OR product_name ILIKE $2 OR raw_email_subject ILIKE $2)
    ORDER BY created_at DESC LIMIT 1
  `;
  try {
    const res = await pool.query(sql, [owner_email, `%${keyword}%`]);
    return res.rows[0] || null; // Return the first row or null if not found
  } catch (err) {
    console.error(
      "PostgreSQL: Error in findFinancialItemByKeywordAndOwner:",
      err.message
    );
    throw err;
  }
};

const addContextHighlight = async (highlight) => {
  const {
    id = uuidv4(), // Generate UUID if not provided
    owner_email,
    financial_item_id, // This should be a UUID if linking
    product_keyword,
    highlight_text,
    source_email_subject,
    source_email_message_id,
  } = highlight;

  const sql = `
    INSERT INTO ContextHighlights (
      id, owner_email, financial_item_id, product_keyword, 
      highlight_text, source_email_subject, source_email_message_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;
  const values = [
    id,
    owner_email,
    financial_item_id,
    product_keyword,
    highlight_text,
    source_email_subject,
    source_email_message_id,
  ];

  try {
    const res = await pool.query(sql, values);
    return res.rows[0];
  } catch (err) {
    console.error("PostgreSQL: Error in addContextHighlight:", err.message);
    // Example: Handle unique constraint if you add one for highlights
    // if (err.code === '23505' && err.constraint === 'your_highlight_unique_constraint_name') {
    //     const newError = new Error("UNIQUE constraint failed for ContextHighlight.");
    //     throw newError;
    // }
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
      "PostgreSQL: Error in getContextHighlightsForItem:",
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
      "PostgreSQL: Error in getContextHighlightsByProductKeywordAndOwner:",
      err.message
    );
    throw err;
  }
};

module.exports = {
  // Expose the pool if direct access is needed for transactions or complex queries elsewhere
  // pool, // Uncomment if needed
  initializeDb, // Expose for potential re-initialization or scripting
  addFinancialItem,
  getFinancialItemsByOwner,
  findFinancialItemByKeywordAndOwner,
  addContextHighlight,
  getContextHighlightsForItem,
  getContextHighlightsByProductKeywordAndOwner,
};
