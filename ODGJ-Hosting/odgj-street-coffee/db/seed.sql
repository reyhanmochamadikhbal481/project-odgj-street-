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

-- Menu (harga dalam rupiah)
INSERT INTO menu_items (category_id, name, description, price, emoji, is_available, is_bestseller, sort_order)
SELECT c.id, v.name, v.description, v.price, v.emoji, v.avail, v.best, v.ord
FROM (
  VALUES
    ('susu',    'Kopi Susu Gula Aren',  'Espresso, susu segar, gula aren cair',         14000, '🥛', TRUE,  TRUE,  1),
    ('susu',    'Kopi Susu Vanila',     'Perpaduan vanila lembut dan kopi robusta',     15000, '☕',  TRUE,  FALSE, 2),
    ('susu',    'Kopi Susu Karamel',    'Karamel gosong khas gerobak',                  16000, '🍮',  TRUE,  FALSE, 3),
    ('susu',    'Cappuccino Dingin',    'Busa tebal, rasa seimbang',                    17000, '🧋',  FALSE, FALSE, 4),
    ('item',    'Es Kopi Item',         'Kopi robusta tubruk, tanpa gula',               8000, '🖤',  TRUE,  FALSE, 1),
    ('item',    'Americano',            'Espresso, air, es batu kristal',               13000, '⚫',  TRUE,  FALSE, 2),
    ('item',    'Kopi Tubruk Panas',    'Diseduh langsung, ampas mengendap',             9000, '🔥',  TRUE,  FALSE, 3),
    ('item',    'Long Black',           'Double shot, untuk yang butuh melek total',    15000, '💪',  TRUE,  FALSE, 4),
    ('nonkopi', 'Cokelat Dingin',       'Cokelat bubuk premium, susu full cream',       14000, '🍫',  TRUE,  FALSE, 1),
    ('nonkopi', 'Matcha Latte',         'Matcha grade A, susu segar',                   16000, '🍵',  TRUE,  FALSE, 2),
    ('nonkopi', 'Teh Tarik',            'Teh susu ditarik khas warung',                 10000, '🫖',  TRUE,  FALSE, 3),
    ('camilan', 'Pisang Goreng Krispi', '5 potong, sambal cocolan cokelat',             12000, '🍌',  TRUE,  FALSE, 1),
    ('camilan', 'Roti Bakar Coklat Keju','Roti tebal, coklat leleh, keju parut',       15000, '🍞',  TRUE,  FALSE, 2),
    ('camilan', 'Tahu Crispy',          '8 potong, sambal petis pedas',                 10000, '🍢',  FALSE, FALSE, 3)
) AS v(slug, name, description, price, emoji, avail, best, ord)
JOIN categories c ON c.slug = v.slug;

COMMIT;