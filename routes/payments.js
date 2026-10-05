const express = require('express');
const crypto = require('crypto');
const pool = require('../config/db');
const eventBus = require('../events/eventBus');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Midtrans config (pakai sandbox, ganti di .env untuk production)
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-XXXXXXXX';
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-XXXXXXXX';
const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const MIDTRANS_BASE = MIDTRANS_IS_PRODUCTION
  ? 'https://api.midtrans.com'
  : 'https://api.sandbox.midtrans.com';

function midtransAuth() {
  return 'Basic ' + Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64');
}

/**
 * POST /api/payments/deposit/create — buat transaksi QRIS untuk deposit reservasi
 * Body: { reservation_id }
 * Return: { token, redirect_url, qr_string }
 */
router.post('/deposit/create', async (req, res) => {
  try {
    const { reservation_id } = req.body;
    if (!reservation_id) return res.status(400).json({ error: 'reservation_id wajib' });

    const resRes = await pool.query(
      `SELECT r.id, r.booking_code, r.deposit_amount, r.party_size, r.reservation_date, r.reservation_time,
              dp.id AS deposit_id, dp.status AS deposit_status
       FROM reservations r
       LEFT JOIN deposit_payments dp ON dp.reservation_id = r.id
       WHERE r.id = $1`,
      [reservation_id]
    );
    if (resRes.rowCount === 0) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan' });
    }
    const reservation = resRes.rows[0];

    if (!reservation.deposit_id) {
      return res.status(400).json({ error: 'Reservasi ini tidak memerlukan DP' });
    }
    if (reservation.deposit_status === 'settlement') {
      return res.status(409).json({ error: 'DP sudah dibayar' });
    }

    const snapPayload = {
      transaction_details: {
        order_id: `ODGJ-RES-${reservation.id}-${Date.now()}`,
        gross_amount: reservation.deposit_amount,
      },
      item_details: [
        {
          id: `deposit_${reservation.id}`,
          price: reservation.deposit_amount,
          quantity: 1,
          name: `DP Reservasi #${reservation.booking_code} - ${reservation.party_size} orang`,
        },
      ],
      customer_details: {
        first_name: 'Customer',
        email: 'customer@odgj.com',
      },
      enabled_payments: ['qris'],
      callbacks: {
        finish: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/reservation/${reservation.id}`,
      },
    };

    const midtransRes = await fetch(`${MIDTRANS_BASE}/v2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: midtransAuth(),
      },
      body: JSON.stringify(snapPayload),
    });

    const midtransData = await midtransRes.json();

    if (!midtransRes.ok) {
      await pool.query('UPDATE deposit_payments SET status = $1 WHERE id = $2', ['deny', reservation.deposit_id]);
      return res.status(502).json({ error: 'Gagal membuat transaksi QRIS', detail: midtransData });
    }

    await pool.query(
      `UPDATE deposit_payments SET gateway_ref = $1, raw_payload = $2, updated_at = NOW()
       WHERE id = $3`,
      [midtransData.token, JSON.stringify(midtransData), reservation.deposit_id]
    );

    res.json({
      token: midtransData.token,
      redirect_url: midtransData.redirect_url,
      qr_string: midtransData.qr_string,
      deposit_payment_id: reservation.deposit_id,
    });
  } catch (err) {
    console.error('[payment/deposit/create] error:', err.message);
    res.status(500).json({ error: 'Gagal membuat pembayaran DP' });
  }
});

/**
 * POST /api/payments/create — buat transaksi QRIS dari order yang sudah ada
 * Body: { order_id }
 * Return: { token, redirect_url, qr_string }
 */
router.post('/create', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id wajib' });

    // Cek order
    const orderRes = await pool.query(
      `SELECT id, queue_number, total, status FROM orders WHERE id = $1`,
      [order_id]
    );
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }
    const order = orderRes.rows[0];

    // Cek apakah sudah ada payment pending/settlement
    const existingPay = await pool.query(
      `SELECT * FROM payments WHERE order_id = $1 AND status IN ('pending','settlement')`,
      [order_id]
    );
    if (existingPay.rowCount > 0) {
      return res.status(409).json({ error: 'Pembayaran sudah diproses', payment: existingPay.rows[0] });
    }

    // Buat payment record pending
    const payRes = await pool.query(
      `INSERT INTO payments (order_id, method, gateway, amount, status)
       VALUES ($1, 'qris', 'midtrans', $2, 'pending')
       RETURNING *`,
      [order_id, order.total]
    );
    const payment = payRes.rows[0];

    // Panggil Midtrans Snap API
    const snapPayload = {
      transaction_details: {
        order_id: `ODGJ-${order.id}-${Date.now()}`,
        gross_amount: order.total,
      },
      item_details: [
        {
          id: `order_${order.id}`,
          price: order.total,
          quantity: 1,
          name: `Pesanan #${order.queue_number} - ODGJ Street Coffee`,
        },
      ],
      customer_details: {
        first_name: 'Customer',
        email: 'customer@odgj.com',
      },
      enabled_payments: ['qris'],
      callbacks: {
        finish: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/order/${order.id}`,
      },
    };

    const midtransRes = await fetch(`${MIDTRANS_BASE}/v2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: midtransAuth(),
      },
      body: JSON.stringify(snapPayload),
    });

    const midtransData = await midtransRes.json();

    if (!midtransRes.ok) {
      await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['deny', payment.id]);
      return res.status(502).json({ error: 'Gagal membuat transaksi QRIS', detail: midtransData });
    }

    // Update payment dengan token & redirect_url
    await pool.query(
      `UPDATE payments SET gateway_ref = $1, raw_payload = $2, updated_at = NOW()
       WHERE id = $3`,
      [midtransData.token, JSON.stringify(midtransData), payment.id]
    );

    res.json({
      token: midtransData.token,
      redirect_url: midtransData.redirect_url,
      qr_string: midtransData.qr_string,
      payment_id: payment.id,
    });
  } catch (err) {
    console.error('[payment/create] error:', err.message);
    res.status(500).json({ error: 'Gagal membuat pembayaran' });
  }
});

/**
 * POST /api/payments/webhook — webhook Midtrans (idempotent via gateway_ref)
 * Handle both order payments (ODGJ-{id}-) and deposit payments (ODGJ-RES-{id}-)
 * Harus didaftarkan di Midtrans dashboard: https://dashboard.midtrans.com/settings/webhook
 */
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;

    const { transaction_id, order_id, transaction_status, fraud_status, gross_amount } = payload;

    if (!transaction_id || !order_id) {
      return res.status(400).send('Missing transaction_id or order_id');
    }

    // Cek tipe payment: order (ODGJ-{id}-) atau deposit (ODGJ-RES-{id}-)
    const isDeposit = order_id.startsWith('ODGJ-RES-');
    const match = isDeposit ? order_id.match(/ODGJ-RES-(\d+)-/) : order_id.match(/ODGJ-(\d+)-/);
    const internalId = match ? Number(match[1]) : null;

    if (!internalId) {
      console.error('[webhook] Tidak bisa parse order_id:', order_id);
      return res.status(400).send('Invalid order_id format');
    }

    const mappedStatus = mapMidtransStatus(transaction_status, fraud_status);

    if (isDeposit) {
      // Handle deposit payment
      const dpRes = await pool.query(
        `SELECT * FROM deposit_payments WHERE reservation_id = $1 AND gateway_ref = $2`,
        [internalId, transaction_id]
      );

      if (dpRes.rowCount === 0) {
        // Buat deposit payment baru (idempotent fallback)
        await pool.query(
          `INSERT INTO deposit_payments (reservation_id, amount, method, gateway, gateway_ref, status, raw_payload, paid_at)
           VALUES ($1, 'qris', 'midtrans', $2, $3, $4, $5, $6)`,
          [internalId, transaction_id, gross_amount, mappedStatus, JSON.stringify(payload), mappedStatus === 'settlement' ? new Date() : null]
        );
      } else {
        // Update existing
        await pool.query(
          `UPDATE deposit_payments SET status = $1, raw_payload = $2, paid_at = $3, updated_at = NOW()
           WHERE id = $4`,
          [mappedStatus, JSON.stringify(payload), mappedStatus === 'settlement' ? new Date() : null, dpRes.rows[0].id]
        );
      }

      // Jika settlement → auto-confirm reservasi
      if (transaction_status === 'settlement' && fraud_status !== 'deny') {
        await pool.query(`UPDATE reservations SET status = 'confirmed' WHERE id = $1`, [internalId]);
        
        // Emit event for notification
        eventBus.publish('DepositPaid', internalId, {
          reservation_id: internalId,
          amount: gross_amount,
          method: 'qris',
          gateway_ref: transaction_id,
        });
      }
    } else {
      // Handle order payment (existing logic)
      const payRes = await pool.query(
        `SELECT * FROM payments WHERE order_id = $1 AND gateway_ref = $2`,
        [internalId, transaction_id]
      );

      let payment;
      if (payRes.rowCount === 0) {
        payment = (await pool.query(
          `INSERT INTO payments (order_id, method, gateway, gateway_ref, amount, status, raw_payload, paid_at)
           VALUES ($1, 'qris', 'midtrans', $2, $3, $4, $5, $6)
           RETURNING *`,
          [internalId, transaction_id, gross_amount, mappedStatus, JSON.stringify(payload), new Date()]
        )).rows[0];
      } else {
        payment = payRes.rows[0];
        await pool.query(
          `UPDATE payments SET status = $1, raw_payload = $2, paid_at = $3, updated_at = NOW()
           WHERE id = $4`,
          [mappedStatus, JSON.stringify(payload), new Date(), payment.id]
        );
      }

      // Jika settlement → emit OrderPaid event
      if (transaction_status === 'settlement' && fraud_status !== 'deny') {
        const orderRes = await pool.query(
          `SELECT id, total FROM orders WHERE id = $1`,
          [internalId]
        );
        if (orderRes.rowCount > 0) {
          eventBus.publish('OrderPaid', orderRes.rows[0].id, {
            order_id: orderRes.rows[0].id,
            payment_id: payment.id,
            amount: orderRes.rows[0].total,
            method: 'qris',
            gateway_ref: transaction_id,
          });
        }
      }
    }

    res.send('OK');
  } catch (err) {
    console.error('[payment/webhook] error:', err.message);
    res.status(500).send('Webhook error');
  }
});

function mapMidtransStatus(transactionStatus, fraudStatus) {
  if (transactionStatus === 'settlement' && fraudStatus !== 'deny') return 'settlement';
  if (transactionStatus === 'pending') return 'pending';
  if (transactionStatus === 'expire') return 'expire';
  if (transactionStatus === 'cancel') return 'cancel';
  if (transactionStatus === 'deny' || fraudStatus === 'deny') return 'deny';
  return 'pending';
}

/**
 * GET /api/payments/:orderId — status pembayaran untuk order
 */
router.get('/:orderId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.orderId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[payment/get] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat status pembayaran' });
  }
});

/**
 * GET /api/payments — riwayat pembayaran (staff)
 */
router.get('/', authenticate, requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, o.queue_number, o.customer_name
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       ORDER BY p.created_at DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[payment/list] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat riwayat pembayaran' });
  }
});

module.exports = router;