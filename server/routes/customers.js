const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

router.get('/', async (req, res) => {
  try {
    const customers = await query('SELECT * FROM customers');
    for (const customer of customers) {
      customer.bankAccounts = await query('SELECT * FROM customer_bank_accounts WHERE customer_id = ?', [customer.id]);
      customer.admins = await query('SELECT * FROM customer_admins WHERE customer_id = ?', [customer.id]);
    }
    res.json({ success: true, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await get('SELECT * FROM customers WHERE id = ?', [id]);
    if (customer) {
      customer.bankAccounts = await query('SELECT * FROM customer_bank_accounts WHERE customer_id = ?', [id]);
      customer.admins = await query('SELECT * FROM customer_admins WHERE customer_id = ?', [id]);
    }
    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { company_name, short_name, company_type, registered_capital, business_license, tax_number, legal_person, address, phone, bankAccounts, admins } = req.body;
    const result = await run(
      'INSERT INTO customers (company_name, short_name, company_type, registered_capital, business_license, tax_number, legal_person, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [company_name, short_name, company_type, registered_capital, business_license, tax_number, legal_person, address, phone]
    );
    const customerId = result.lastID;
    if (bankAccounts && bankAccounts.length > 0) {
      for (const account of bankAccounts) {
        await run(
          'INSERT INTO customer_bank_accounts (customer_id, bank_name, account_number, account_name) VALUES (?, ?, ?, ?)',
          [customerId, account.bank_name, account.account_number, account.account_name]
        );
      }
    }
    if (admins && admins.length > 0) {
      for (const admin of admins) {
        await run(
          'INSERT INTO customer_admins (customer_id, name, position, phone, email) VALUES (?, ?, ?, ?, ?)',
          [customerId, admin.name, admin.position, admin.phone, admin.email]
        );
      }
    }
    res.json({ success: true, data: { id: customerId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { company_name, short_name, company_type, registered_capital, business_license, tax_number, legal_person, address, phone, bankAccounts, admins } = req.body;
    await run(
      'UPDATE customers SET company_name = ?, short_name = ?, company_type = ?, registered_capital = ?, business_license = ?, tax_number = ?, legal_person = ?, address = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [company_name, short_name, company_type, registered_capital, business_license, tax_number, legal_person, address, phone, id]
    );
    await run('DELETE FROM customer_bank_accounts WHERE customer_id = ?', [id]);
    if (bankAccounts && bankAccounts.length > 0) {
      for (const account of bankAccounts) {
        await run(
          'INSERT INTO customer_bank_accounts (customer_id, bank_name, account_number, account_name) VALUES (?, ?, ?, ?)',
          [id, account.bank_name, account.account_number, account.account_name]
        );
      }
    }
    await run('DELETE FROM customer_admins WHERE customer_id = ?', [id]);
    if (admins && admins.length > 0) {
      for (const admin of admins) {
        await run(
          'INSERT INTO customer_admins (customer_id, name, position, phone, email) VALUES (?, ?, ?, ?, ?)',
          [id, admin.name, admin.position, admin.phone, admin.email]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM customers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;