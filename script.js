const userId = 1; // Hardcoded as per provided code; ideally from login session

// Utility function for API requests
async function apiRequest(endpoint, method = 'GET', data = null) {
    try {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (data) options.body = JSON.stringify(data);
        const response = await fetch(`/api${endpoint}`, options);
        const result = await response.json();
        if (!response.ok) {
            console.error(`API request failed: ${endpoint}, Status: ${response.status}, Error: ${result.error}`);
            throw new Error(result.error || 'Request failed');
        }
        console.log(`API response for ${endpoint}:`, result);
        return result;
    } catch (err) {
        console.error(`Network error for ${endpoint}: ${err.message}`);
        throw err;
    }
}

// Load categories for add.html and categories.html
async function loadCategories() {
    const select = document.getElementById('category');
    const list = document.getElementById('category-list');
    try {
        const categories = await apiRequest('/categories');
        if (!Array.isArray(categories)) throw new Error('Invalid categories response');

        if (select) {
            select.innerHTML = '<option value="">Select Category</option>';
            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.category_id;
                option.textContent = cat.name;
                select.appendChild(option);
            });
        }

        if (list) {
            list.innerHTML = '';
            if (categories.length === 0) {
                list.innerHTML = '<p>No categories available.</p>';
                return;
            }
            categories.forEach(category => {
                const div = document.createElement('div');
                div.classList.add('category');
                div.textContent = category.name;
                list.appendChild(div);
            });
        }
    } catch (err) {
        console.error('Failed to load categories:', err.message);
        if (select) alert('Failed to load categories: ' + err.message);
        if (list) list.innerHTML = '<p>Failed to load categories: ' + err.message + '</p>';
    }
}

// Load pantry items for index.html
async function loadPantryItems() {
    const list = document.getElementById('pantry-list');
    if (!list) return;
    try {
        const items = await apiRequest(`/inventory/${userId}`);
        list.innerHTML = '';
        if (items.length === 0) {
            list.innerHTML = '<p>No items in pantry.</p>';
            return;
        }
        items.forEach(item => {
            const div = document.createElement('div');
            div.classList.add('pantry-item');
            div.textContent = `${item.name} (${item.remaining_quantity} ${item.unit}) - Category: ${item.category_name}, Location: ${item.location || 'N/A'}, Expiry: ${item.expiry_date || 'N/A'}`;
            list.appendChild(div);
        });
    } catch (err) {
        console.error('Failed to load pantry items:', err.message);
        list.innerHTML = '<p>Failed to load pantry items: ' + err.message + '</p>';
    }
}

// Load recipes for recipes.html
async function loadRecipes() {
    const list = document.getElementById('recipe-list');
    if (!list) return;
    try {
        const recipes = await apiRequest(`/recipes/available/${userId}`);
        list.innerHTML = '';
        if (recipes.length === 0) {
            list.innerHTML = '<p>No recipes can be made with current inventory. Try adding more items.</p>';
            return;
        }
        recipes.forEach(recipe => {
            const div = document.createElement('div');
            div.classList.add('recipe');
            div.innerHTML = `<strong>${recipe.recipe_name}</strong>: ${recipe.description}`;
            list.appendChild(div);
        });
    } catch (err) {
        console.error('Failed to load recipes:', err.message);
        list.innerHTML = '<p>Failed to load recipes: ' + err.message + '</p>';
    }
}

// Load restock alerts for restock.html
async function loadRestockAlerts() {
    const list = document.getElementById('alert-list');
    if (!list) return;
    try {
        const alerts = await apiRequest(`/restock_alerts/${userId}`);
        list.innerHTML = '';
        if (alerts.length === 0) {
            list.innerHTML = '<p>No restock alerts.</p>';
            return;
        }
        alerts.forEach(alert => {
            const div = document.createElement('div');
            div.classList.add('alert');
            div.innerHTML = `Item: ${alert.item_name} - Min Quantity: ${alert.min_quantity} ${alert.unit || ''} - Current: ${alert.total_remaining_quantity || 0} ${alert.unit || ''} ${alert.alert_enabled ? '(Active)' : '(Disabled)'}`;
            list.appendChild(div);
        });
    } catch (err) {
        console.error('Failed to load restock alerts:', err.message);
        list.innerHTML = '<p>Failed to load restock alerts: ' + err.message + '</p>';
    }
}

// Load items for restock.html alert form
async function loadItemsForAlerts() {
    const select = document.getElementById('alert-item');
    if (!select) return;
    try {
        const items = await apiRequest(`/items/${userId}`);
        select.innerHTML = '<option value="">Select Item</option>';
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.item_id;
            option.textContent = item.name;
            select.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to load items for alerts:', err.message);
        alert('Failed to load items: ' + err.message);
    }
}

// Handle add item form submission
function handleAddItemForm() {
    const form = document.getElementById('add-item-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const itemData = {
            user_id: userId,
            item_name: document.getElementById('item-name').value.trim(),
            category_id: parseInt(document.getElementById('category').value),
            initial_quantity: parseFloat(document.getElementById('quantity').value),
            unit: document.getElementById('unit').value.trim(),
            purchase_date: document.getElementById('purchase-date').value || null,
            expiry_date: document.getElementById('expiry-date').value || null,
            location: document.getElementById('location').value.trim() || null
        };
        if (!itemData.item_name || !itemData.category_id || !itemData.initial_quantity || !itemData.unit) {
            alert('Please fill all required fields.');
            return;
        }
        if (itemData.expiry_date && itemData.purchase_date && new Date(itemData.expiry_date) < new Date(itemData.purchase_date)) {
            alert('Expiry date cannot be before purchase date.');
            return;
        }
        try {
            await apiRequest('/inventory', 'POST', itemData);
            alert('✅ Item added successfully!');
            form.reset();
        } catch (err) {
            alert('❌ Failed to add item: ' + err.message);
        }
    });
}

// Handle remove item form submission
function handleRemoveItemForm() {
    const form = document.getElementById('remove-item-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const itemName = document.getElementById('remove-item-name').value.trim();
        const quantityInput = document.getElementById('quantity').value;
        const quantity = quantityInput ? parseFloat(quantityInput) : null;
        if (!itemName) {
            alert('Please enter an item name.');
            return;
        }
        if (quantity !== null && (isNaN(quantity) || quantity <= 0)) {
            alert('Quantity must be a positive number.');
            return;
        }
        try {
            await apiRequest('/inventory/remove', 'POST', { item_name: itemName, user_id: userId, quantity });
            alert('✅ Item removed successfully!');
            form.reset();
        } catch (err) {
            alert('❌ Failed to remove item: ' + err.message);
        }
    });
}

// Handle restock alert form submission
function handleRestockAlertForm() {
    const form = document.getElementById('add-alert-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            item_id: parseInt(document.getElementById('alert-item').value),
            min_quantity: parseFloat(document.getElementById('min-quantity').value)
        };
        if (!data.item_id || data.min_quantity < 0) {
            alert('Please select an item and enter a valid minimum quantity.');
            return;
        }
        try {
            await apiRequest('/restock_alerts', 'POST', data);
            alert('✅ Restock alert added!');
            form.reset();
            await loadRestockAlerts();
        } catch (err) {
            alert('❌ Failed to add restock alert: ' + err.message);
        }
    });
}

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([
            loadCategories(),
            loadPantryItems(),
            loadRecipes(),
            loadItemsForAlerts(),
            loadRestockAlerts()
        ]);
    } catch (err) {
        console.error('Initialization error:', err.message);
    }

    handleAddItemForm();
    handleRemoveItemForm();
    handleRestockAlertForm();

    // Check for expiry alerts only on restock.html
    if (window.location.pathname.endsWith('restock.html')) {
        try {
            const alerts = await apiRequest(`/expiry_alerts/${userId}`);
            if (alerts.length > 0) {
                const message = alerts.map(a => `${a.item_name} expires on ${a.expiry_date}`).join('\n');
                alert('⚠️ Expiry Alerts:\n' + message);
            }
        } catch (err) {
            console.error('Failed to load expiry alerts:', err.message);
        }
    }
});