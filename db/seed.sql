-- ============================================================
-- ODGJ STREET COFFEE — Seed Data Menu
-- ============================================================

BEGIN;

-- Kategori
INSERT INTO categories (slug, name, sort_order) VALUES
  ('susu',    'Kopi Susu',  1),
  ('item',    'Kopi Hitam', 2),
  ('nonkopi', 'Non-Kopi',   3),
  ('camilan', 'Camilan',    4)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- GANTI FOTO: Edit URL di bawah ini untuk masing-masing menu
-- Contoh: 'https://images.unsplash.com/photo-XXXX?w=400&q=80'
-- Atau link dari Google Images: 'https://example.com/foto.jpg'
-- ============================================================
-- Menu (harga dalam rupiah) — foto lokal di public/images/menu/ (cocok per nama)
INSERT INTO menu_items (category_id, name, description, price, emoji, photo_url, is_available, is_bestseller, sort_order)
SELECT c.id, v.name, v.description, v.price, v.emoji, v.photo, v.avail, v.best, v.ord
FROM (
  VALUES
    ('susu',    'Kopi Susu Gula Aren',  'Espresso, susu segar, gula aren cair',         14000, '🥛', '/images/menu/kopi-susu-gula-aren.jpg', TRUE,  TRUE,  1),
    ('susu',    'Kopi Susu Vanila',     'Perpaduan vanila lembut dan kopi robusta',     15000, '☕',  '/images/menu/kopi-susu-vanila.jpg', TRUE,  FALSE, 2),
    ('susu',    'Kopi Susu Karamel',    'Karamel gosong khas gerobak',                  16000, '🍮',  '/images/menu/kopi-susu-karamel.jpg', TRUE,  FALSE, 3),
    ('susu',    'Cappuccino Dingin',    'Busa tebal, rasa seimbang',                    17000, '🧋',  '/images/menu/cappuccino-dingin.jpg', FALSE, FALSE, 4),
    ('item',    'Es Kopi Item',         'Kopi robusta tubruk, tanpa gula',               8000, '🖤',  '/images/menu/es-kopi-hitam.jpg', TRUE,  FALSE, 1),
    ('item',    'Americano',            'Espresso, air, es batu kristal',               13000, '⚫',  '/images/menu/americano.jpg', TRUE,  FALSE, 2),
    ('item',    'Kopi Tubruk Panas',    'Diseduh langsung, ampas mengendap',             9000, '🔥',  '/images/menu/kopi-tubruk-panas.jpg', TRUE,  FALSE, 3),
    ('item',    'Long Black',           'Double shot, untuk yang butuh melek total',    15000, '💪',  '/images/menu/long-black.jpg', TRUE,  FALSE, 4),
    ('nonkopi', 'Cokelat Dingin',       'Cokelat bubuk premium, susu full cream',       14000, '🍫',  '/images/menu/cokelat-dingin.jpg', TRUE,  FALSE, 1),
    ('nonkopi', 'Matcha Latte',         'Matcha grade A, susu segar',                   16000, '🍵',  '/images/menu/matcha-latte.jpg', TRUE,  FALSE, 2),
    ('nonkopi', 'Teh Tarik',            'Teh susu ditarik khas warung',                 10000, '🫖',  '/images/menu/teh-tarik.jpg', TRUE,  FALSE, 3),
    ('camilan', 'Pisang Goreng Krispi', '5 potong, sambal cocolan cokelat',             12000, '🍌',  '/images/menu/pisang-goreng-krispi.jpg', TRUE,  FALSE, 1),
    ('camilan', 'Roti Bakar Coklat Keju','Roti tebal, coklat leleh, keju parut',       15000, '🍞',  '/images/menu/roti-bakar-coklat-keju.jpg', TRUE,  FALSE, 2),
    ('camilan', 'Tahu Crispy',          '8 potong, sambal petis pedas',                 10000, '🍢',  '/images/menu/tahu-crispy.jpg', FALSE, FALSE, 3)
) AS v(slug, name, description, price, emoji, photo, avail, best, ord)
JOIN categories c ON c.slug = v.slug;

COMMIT;