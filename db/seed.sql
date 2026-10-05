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
-- Menu (harga dalam rupiah)
INSERT INTO menu_items (category_id, name, description, price, emoji, photo_url, is_available, is_bestseller, sort_order)
SELECT c.id, v.name, v.description, v.price, v.emoji, v.photo, v.avail, v.best, v.ord
FROM (
  VALUES
    ('susu',    'Kopi Susu Gula Aren',  'Espresso, susu segar, gula aren cair',         14000, '🥛', 'https://images.unsplash.com/photo-1587734195503-904c31d21bf7?w=400&q=80', TRUE,  TRUE,  1),
    ('susu',    'Kopi Susu Vanila',     'Perpaduan vanila lembut dan kopi robusta',     15000, '☕',  'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=400&q=80', TRUE,  FALSE, 2),
    ('susu',    'Kopi Susu Karamel',    'Karamel gosong khas gerobak',                  16000, '🍮',  'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&q=80', TRUE,  FALSE, 3),
    ('susu',    'Cappuccino Dingin',    'Busa tebal, rasa seimbang',                    17000, '🧋',  'https://images.unsplash.com/photo-1570968915860-54d5c301facc?w=400&q=80', FALSE, FALSE, 4),
    ('item',    'Es Kopi Item',         'Kopi robusta tubruk, tanpa gula',               8000, '🖤',  'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&q=80', TRUE,  FALSE, 1),
    ('item',    'Americano',            'Espresso, air, es batu kristal',               13000, '⚫',  'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&q=80', TRUE,  FALSE, 2),
    ('item',    'Kopi Tubruk Panas',    'Diseduh langsung, ampas mengendap',             9000, '🔥',  'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=400&q=80', TRUE,  FALSE, 3),
    ('item',    'Long Black',           'Double shot, untuk yang butuh melek total',    15000, '💪',  'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=400&q=80', TRUE,  FALSE, 4),
    ('nonkopi', 'Cokelat Dingin',       'Cokelat bubuk premium, susu full cream',       14000, '🍫',  'https://images.unsplash.com/photo-1542113647-1672d7d831a6?w=400&q=80', TRUE,  FALSE, 1),
    ('nonkopi', 'Matcha Latte',         'Matcha grade A, susu segar',                   16000, '🍵',  'https://images.unsplash.com/photo-1515823064-d6e0c046ff4a?w=400&q=80', TRUE,  FALSE, 2),
    ('nonkopi', 'Teh Tarik',            'Teh susu ditarik khas warung',                 10000, '🫖',  'https://images.unsplash.com/photo-1556881286-fc6915169721?w=400&q=80', TRUE,  FALSE, 3),
    ('camilan', 'Pisang Goreng Krispi', '5 potong, sambal cocolan cokelat',             12000, '🍌',  'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=400&q=80', TRUE,  FALSE, 1),
    ('camilan', 'Roti Bakar Coklat Keju','Roti tebal, coklat leleh, keju parut',       15000, '🍞',  'https://images.unsplash.com/photo-1548907038-43041aba4c63?w=400&q=80', TRUE,  FALSE, 2),
    ('camilan', 'Tahu Crispy',          '8 potong, sambal petis pedas',                 10000, '🍢',  'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=400&q=80', FALSE, FALSE, 3)
) AS v(slug, name, description, price, emoji, photo, avail, best, ord)
JOIN categories c ON c.slug = v.slug;

COMMIT;