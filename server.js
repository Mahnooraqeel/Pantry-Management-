const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt'); // Although not used in this specific login for password comparison, it's good to keep it if you plan to use it for registration.
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Assuming your HTML, CSS, JS are in a 'public' directory

// DB Connection Pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'noor',
    database: 'pantry_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection on startup
async function testDbConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Successfully connected to MySQL database');
        connection.release();
    } catch (err) {
        console.error('❌ Failed to connect to MySQL database:', err.message);
        process.exit(1); // Exit the process if DB connection fails
    }
}

// Execute query with detailed error logging
async function query(sql, params) {
    try {
        const [results] = await pool.execute(sql, params);
        console.log(`✅ Query executed: ${sql} with params: ${params || 'none'} (Rows: ${results.length || results.affectedRows})`);
        return results;
    } catch (err) {
        console.error(`❌ Query failed: ${sql}`);
        console.error(`Params: ${params || 'none'}`);
        console.error(`Error: ${err.message}`);
        throw err;
    }
}

// Initialize database connection
testDbConnection();

// ====================== Auth ======================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const users = await query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(400).json({ error: 'Invalid email or password' });

        const valid = await bcrypt.compare(password, users[0].password_hash); // Use this line if password_hash is a bcrypt hash

        if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

        res.json({ message: 'Login successful', user: { id: users[0].user_id, name: users[0].name } });
    } catch (err) {
        res.status(500).json({ error: `Login failed: ${err.message}` });
    }
});

// ====================== User ======================
app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await query('SELECT name, email FROM users WHERE user_id = ?', [req.params.id]);
        if (user.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(user[0]);
    } catch (err) {
        res.status(500).json({ error: `Failed to fetch user: ${err.message}` });
    }
});

// ====================== Categories ======================
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await query('SELECT * FROM categories', []);
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: `Failed to fetch categories: ${err.message}` });
    }
});

// ====================== Items ======================
app.get('/api/items/:user_id', async (req, res) => {
    try {
        const items = await query(`
            SELECT i.item_id, i.name, i.barcode, c.name AS category_name
            FROM items i
            JOIN categories c ON i.category_id = c.category_id
            WHERE i.user_id = ?
        `, [req.params.user_id]);
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: `Failed to fetch items: ${err.message}` });
    }
});

// ====================== Inventory ======================
app.get('/api/inventory/:user_id', async (req, res) => {
    try {
        const inventory = await query(`
            SELECT inv.*, i.name, c.name AS category_name
            FROM inventory inv
            JOIN items i ON inv.item_id = i.item_id
            JOIN categories c ON i.category_id = c.category_id
            WHERE i.user_id = ?
        `, [req.params.user_id]);
        res.json(inventory);
    } catch (err) {
        res.status(500).json({ error: `Failed to fetch inventory: ${err.message}` });
    }
});

app.post('/api/inventory', async (req, res) => {
    const { user_id, item_name, category_id, initial_quantity, unit, purchase_date, expiry_date, location } = req.body;
    if (!item_name || !initial_quantity || !category_id || !unit || !user_id) {
        return res.status(400).json({ error: 'Required fields: user_id, item_name, category_id, initial_quantity, unit' });
    }

    try {
        let item = await query('SELECT * FROM items WHERE name = ? AND user_id = ?', [item_name, user_id]);
        let item_id;

        if (item.length === 0) {
            const result = await query(
                'INSERT INTO items (user_id, name, category_id) VALUES (?, ?, ?)',
                [user_id, item_name, category_id]
            );
            item_id = result.insertId;
        } else {
            item_id = item[0].item_id;
        }

        const inventoryResult = await query(
            'INSERT INTO inventory (item_id, purchase_date, expiry_date, initial_quantity, remaining_quantity, unit, location) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [item_id, purchase_date || null, expiry_date || null, initial_quantity, initial_quantity, unit, location || null]
        );

        await query('INSERT INTO transactions (inventory_id, transaction_type, quantity_changed) VALUES (?, ?, ?)',
            [inventoryResult.insertId, 'add', initial_quantity]);

        res.json({ message: 'Item added to inventory', inventory_id: inventoryResult.insertId });
    } catch (err) {
        res.status(500).json({ error: `Failed to add inventory: ${err.message}` });
    }
});

app.post('/api/inventory/remove', async (req, res) => {
    const { item_name, user_id, quantity } = req.body;
    if (!item_name || !user_id) return res.status(400).json({ error: 'Missing item_name or user_id' });
    if (quantity && (isNaN(quantity) || quantity <= 0)) {
        return res.status(400).json({ error: 'Quantity must be a positive number' });
    }

    try {
        const items = await query('SELECT * FROM items WHERE name = ? AND user_id = ?', [item_name, user_id]);
        if (items.length === 0) return res.status(404).json({ error: `Item "${item_name}" not found` });

        const item = items[0];
        // Order by expiry_date for FIFO removal
        const inventories = await query('SELECT * FROM inventory WHERE item_id = ? ORDER BY expiry_date ASC, purchase_date ASC', [item.item_id]);

        if (inventories.length === 0) return res.status(404).json({ error: `No inventory found for "${item_name}"` });

        if (quantity) {
            let remainingQuantityToRemove = parseFloat(quantity);
            for (let inv of inventories) {
                if (remainingQuantityToRemove <= 0) break; // All requested quantity removed

                const currentInventory = await query('SELECT remaining_quantity FROM inventory WHERE inventory_id = ?', [inv.inventory_id]);
                if (currentInventory.length === 0) continue; // Should not happen if 'inventories' was just fetched

                const available = currentInventory[0].remaining_quantity;
                const toRemove = Math.min(available, remainingQuantityToRemove);
                remainingQuantityToRemove -= toRemove;

                await query('UPDATE inventory SET remaining_quantity = remaining_quantity - ? WHERE inventory_id = ?',
                    [toRemove, inv.inventory_id]);
                await query('INSERT INTO transactions (inventory_id, transaction_type, quantity_changed) VALUES (?, ?, ?)',
                    [inv.inventory_id, 'consume', toRemove]);

                const updatedInventory = await query('SELECT remaining_quantity FROM inventory WHERE inventory_id = ?', [inv.inventory_id]);
                if (updatedInventory[0].remaining_quantity <= 0) {
                    // If the inventory entry is depleted, clean it up
                    // First delete related transactions, then the inventory entry
                    await query('DELETE FROM transactions WHERE inventory_id = ?', [inv.inventory_id]);
                    await query('DELETE FROM inventory WHERE inventory_id = ?', [inv.inventory_id]);
                }
            }
            if (remainingQuantityToRemove > 0) {
                // If after iterating through all relevant inventory, some quantity still remains to be removed
                return res.status(400).json({ error: `Not enough quantity available for "${item_name}". Missing: ${remainingQuantityToRemove} ${item.unit || 'units'}` });
            }
        } else {
            // No specific quantity provided, remove all instances of the item
            for (const inv of inventories) {
                await query('INSERT INTO transactions (inventory_id, transaction_type, quantity_changed) VALUES (?, ?, ?)',
                    [inv.inventory_id, 'remove', inv.remaining_quantity]); // Log remaining_quantity being removed
                await query('DELETE FROM transactions WHERE inventory_id = ?', [inv.inventory_id]);
                await query('DELETE FROM inventory WHERE inventory_id = ?', [inv.inventory_id]);
            }
        }

        res.json({ message: `Successfully removed "${item_name}" from inventory` });
    } catch (err) {
        res.status(500).json({ error: `Failed to remove item: ${err.message}` });
    }
});

// ====================== Recipes ======================
app.get('/api/recipes/available/:user_id', async (req, res) => {
    const userId = req.params.user_id;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const recipes = await query(`
            SELECT DISTINCT r.recipe_id, r.name AS recipe_name, r.description
            FROM recipes r
            JOIN recipe_ingredients ri ON r.recipe_id = ri.recipe_id
            JOIN items i ON ri.item_id = i.item_id
            LEFT JOIN inventory inv ON i.item_id = inv.item_id
            WHERE i.user_id = ?
            GROUP BY r.recipe_id, r.name, r.description
            HAVING COUNT(ri.item_id) = SUM(CASE 
                WHEN inv.remaining_quantity IS NOT NULL 
                AND inv.remaining_quantity >= ri.quantity_needed 
                AND (inv.unit = ri.unit OR inv.unit IS NULL OR ri.unit IS NULL)
                THEN 1 
                WHEN inv.remaining_quantity IS NOT NULL 
                AND inv.unit != ri.unit 
                AND inv.remaining_quantity > 0
                THEN 1
                ELSE 0 
            END)
        `, [userId]);
        console.log(`Recipes found for user ${userId}:`, recipes);
        res.json(recipes);
    } catch (err) {
        console.error('❌ Failed to fetch available recipes:', err.message);
        res.status(500).json({ error: `Failed to fetch recipes: ${err.message}` });
    }
});

// ====================== Restock Alerts ======================
app.get('/api/restock_alerts/:user_id', async (req, res) => {
    try {
        const alerts = await query(`
            SELECT ra.alert_id, i.name AS item_name, ra.min_quantity, ra.alert_enabled,
                   COALESCE(SUM(inv.remaining_quantity), 0) AS total_remaining_quantity,
                   inv.unit -- Display a representative unit, or handle multiple units
            FROM restock_alerts ra
            JOIN items i ON ra.item_id = i.item_id
            LEFT JOIN inventory inv ON i.item_id = inv.item_id
            WHERE i.user_id = ? AND ra.alert_enabled = TRUE
            GROUP BY ra.alert_id, i.name, ra.min_quantity, ra.alert_enabled, inv.unit
            HAVING total_remaining_quantity <= ra.min_quantity OR total_remaining_quantity = 0
            ORDER BY item_name
        `, [req.params.user_id]);

        // Post-process to handle multiple units for the same item if needed,
        // or just send what the query provides (first unit encountered if grouped by unit)
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: `Failed to fetch restock alerts: ${err.message}` });
    }
});

app.post('/api/restock_alerts', async (req, res) => {
    const { item_id, min_quantity } = req.body;
    if (!item_id || min_quantity == null) return res.status(400).json({ error: 'Missing item_id or min_quantity' });

    try {
        const existing = await query('SELECT * FROM restock_alerts WHERE item_id = ?', [item_id]);
        if (existing.length > 0) {
            await query('UPDATE restock_alerts SET min_quantity = ?, alert_enabled = TRUE WHERE item_id = ?', [min_quantity, item_id]);
        } else {
            await query('INSERT INTO restock_alerts (item_id, min_quantity) VALUES (?, ?)', [item_id, min_quantity]);
        }
        res.json({ message: 'Restock alert set' });
    } catch (err) {
        res.status(500).json({ error: `Failed to set restock alert: ${err.message}` });
    }
});

// ====================== Expiry Alerts ======================
app.get('/api/expiry_alerts/:user_id', async (req, res) => {
    try {
        // Fetch items expiring within the next 3 days, or already expired
        const alerts = await query(`
            SELECT i.name AS item_name, inv.expiry_date, inv.remaining_quantity, inv.unit
            FROM inventory inv
            JOIN items i ON inv.item_id = i.item_id
            WHERE i.user_id = ?
            AND inv.expiry_date IS NOT NULL
            AND inv.remaining_quantity > 0 -- Only alert for items still present
            AND inv.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)
            ORDER BY inv.expiry_date ASC
        `, [req.params.user_id]);
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: `Failed to fetch expiry alerts: ${err.message}` });
    }
});

// ====================== Default: Serve HTML ======================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====================== Start Server ======================
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});