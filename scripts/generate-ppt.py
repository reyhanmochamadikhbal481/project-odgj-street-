from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
import copy

# ── Warna: Cream & Coffee ──
ESPRESSO = RGBColor(0x2C, 0x18, 0x10)    # sangat gelap (bg slide gelap)
COFFEE = RGBColor(0x4E, 0x34, 0x2E)      # kopi tua (header bar, aksen utama)
MOCHA = RGBColor(0x6D, 0x4C, 0x41)       # mocha (elemen sekunder)
LATTE = RGBColor(0xA1, 0x88, 0x7F)       # latte (garis lembut)
CARAMEL = RGBColor(0xC6, 0x8B, 0x59)     # caramel (highlight)
CREAM = RGBColor(0xF5, 0xE6, 0xD3)       # cream terang (teks di bg gelap)
FOAM = RGBColor(0xFF, 0xF8, 0xE7)        # foam putih-krem (bg terang)
BEIGE = RGBColor(0xE8, 0xD5, 0xB7)       # beige (border, divider)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
GRAY = RGBColor(0x9E, 0x95, 0x8A)        # abu-abu kecoklatan
GREEN = RGBColor(0x5D, 0x8A, 0x5E)       # hijau kalem (status baik)
YELLOW = RGBColor(0xD4, 0xA5, 0x3C)      # kuning madu (status sedang)
ORANGE = RGBColor(0xC8, 0x7D, 0x3A)      # oranye karamel (status perhatian)
RED = COFFEE                              # alias: aksen utama = coffee
BLACK = ESPRESSO                          # alias: bg gelap = espresso
DARK = RGBColor(0x3A, 0x22, 0x1A)         # dark coffee (kotak kontras)
LIGHT_BG = FOAM                           # bg terang = foam

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

W = prs.slide_width
H = prs.slide_height


def add_bg(slide, color=BLACK):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_rect(slide, left, top, width, height, fill_color, line_color=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    if line_color:
        shape.line.color.rgb = line_color
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    return shape


def add_rounded(slide, left, top, width, height, fill_color):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    return shape


def add_text(slide, left, top, width, height, text, size=18, color=WHITE,
             bold=False, align=PP_ALIGN.LEFT, font_name="Calibri", anchor=MSO_ANCHOR.TOP):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    try:
        tf._txBody.bodyPr.set('anchor', {MSO_ANCHOR.TOP: 't', MSO_ANCHOR.MIDDLE: 'ctr', MSO_ANCHOR.BOTTOM: 'b'}[anchor])
    except Exception:
        pass
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(size)
    p.font.color.rgb = color
    p.font.bold = bold
    p.font.name = font_name
    p.alignment = align
    return txBox


def add_multiline(slide, left, top, width, height, lines, size=16, color=WHITE,
                  bold=False, align=PP_ALIGN.LEFT, font_name="Calibri", line_spacing=1.2, anchor=MSO_ANCHOR.TOP):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    try:
        tf._txBody.bodyPr.set('anchor', {MSO_ANCHOR.TOP: 't', MSO_ANCHOR.MIDDLE: 'ctr', MSO_ANCHOR.BOTTOM: 'b'}[anchor])
    except Exception:
        pass
    for i, line in enumerate(lines):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        if isinstance(line, tuple):
            txt, c, b = line
        else:
            txt, c, b = line, color, bold
        p.text = txt
        p.font.size = Pt(size)
        p.font.color.rgb = c
        p.font.bold = b
        p.font.name = font_name
        p.alignment = align
        p.space_after = Pt(size * (line_spacing - 1))
    return txBox


def slide_number(slide, num):
    add_text(slide, W - Inches(0.7), H - Inches(0.45), Inches(0.5), Inches(0.3),
             str(num), size=11, color=GRAY, align=PP_ALIGN.RIGHT)


def header_bar(slide, title, subtitle=""):
    add_rect(slide, 0, 0, W, Inches(1.1), RED)
    add_text(slide, Inches(0.5), Inches(0.15), Inches(10), Inches(0.55),
             title, size=30, color=WHITE, bold=True)
    if subtitle:
        add_text(slide, Inches(0.5), Inches(0.65), Inches(11), Inches(0.35),
                 subtitle, size=14, color=CREAM)


def add_table(slide, left, top, width, rows, col_widths, header_color=RED,
              row_colors=None, font_size=12):
    n_rows = len(rows)
    n_cols = len(rows[0])
    table_shape = slide.shapes.add_table(n_rows, n_cols, left, top, width, Inches(0.4 * n_rows))
    table = table_shape.table
    # set col widths
    total = sum(col_widths)
    for i, w in enumerate(col_widths):
        table.columns[i].width = int(width * w / total)
    for r, row in enumerate(rows):
        for c, cell_text in enumerate(row):
            cell = table.cell(r, c)
            cell.text = str(cell_text)
            for p in cell.text_frame.paragraphs:
                p.font.size = Pt(font_size)
                p.font.name = "Calibri"
                if r == 0:
                    p.font.color.rgb = WHITE
                    p.font.bold = True
                else:
                    p.font.color.rgb = BLACK
            if r == 0:
                cell.fill.solid()
                cell.fill.fore_color.rgb = header_color
            elif row_colors and r < len(row_colors) and row_colors[r]:
                cell.fill.solid()
                cell.fill.fore_color.rgb = row_colors[r]
            else:
                cell.fill.solid()
                cell.fill.fore_color.rgb = WHITE if r % 2 == 1 else BEIGE
    return table_shape


def bullet_box(slide, left, top, width, height, title, bullets, title_color=RED,
               bg_color=WHITE, text_color=BLACK, size=14):
    add_rounded(slide, left, top, width, height, bg_color)
    add_text(slide, left + Inches(0.2), top + Inches(0.1), width - Inches(0.4), Inches(0.4),
             title, size=size + 2, color=title_color, bold=True)
    lines = []
    for b in bullets:
        if isinstance(b, tuple):
            lines.append(b)
        else:
            lines.append(("  \u2022 " + b, text_color, False))
    add_multiline(slide, left + Inches(0.2), top + Inches(0.5), width - Inches(0.4),
                  height - Inches(0.6), lines, size=size, color=text_color, line_spacing=1.35)


def add_notes(slide, text):
    """Tambahkan catatan presenter (speaker notes) ke slide."""
    notes = slide.notes_slide
    notes.notes_text_frame.text = text


# ══════════════════════════════════════════════════════════════
# SLIDE 1 — TITLE
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, BLACK)
add_rect(s, 0, Inches(2.8), W, Inches(0.06), RED)
add_text(s, Inches(1), Inches(1.0), Inches(11), Inches(1.0),
         "ODGJ STREET COFFEE", size=48, color=RED, bold=True, align=PP_ALIGN.CENTER)
add_text(s, Inches(1), Inches(1.9), Inches(11), Inches(0.7),
         "Blueprint v2.0 vs Current Implementation", size=28, color=CREAM, align=PP_ALIGN.CENTER)
add_text(s, Inches(1), Inches(2.4), Inches(11), Inches(0.4),
         "Gap Analysis & Implementation Roadmap", size=18, color=GRAY, align=PP_ALIGN.CENTER)

# Progress badge
badge = add_rounded(s, Inches(4.8), Inches(3.4), Inches(3.7), Inches(1.5), DARK)
add_text(s, Inches(4.8), Inches(3.5), Inches(3.7), Inches(0.5),
         "CURRENT PROGRESS", size=14, color=GRAY, align=PP_ALIGN.CENTER, bold=True)
add_text(s, Inches(4.8), Inches(3.85), Inches(3.7), Inches(0.9),
         "~18%", size=54, color=RED, bold=True, align=PP_ALIGN.CENTER)

add_text(s, Inches(1), Inches(5.3), Inches(11), Inches(0.4),
         "Enterprise Application Architecture Blueprint", size=16, color=GRAY, align=PP_ALIGN.CENTER)
add_text(s, Inches(1), Inches(5.7), Inches(11), Inches(0.4),
         "07 Oktober 2026", size=14, color=GRAY, align=PP_ALIGN.CENTER)
add_text(s, Inches(1), Inches(6.5), Inches(11), Inches(0.4),
         "Next.js 14 \u00b7 NestJS 10 \u00b7 PostgreSQL 15 \u00b7 Redis 7 \u00b7 Socket.io \u00b7 RabbitMQ \u00b7 Kubernetes",
         size=12, color=GRAY, align=PP_ALIGN.CENTER)

add_notes(s, """SLIDE 1 - OPENING

Perkenalkan diri: Nama saya Reyhan, hari ini saya akan menyampaikan analisis gap antara Blueprint Enterprise v2.0
dan kondisi aktual project web ODGJ Street Coffee.

Poin kunci pembuka:
- Project ini adalah platform manajemen & e-menu coffeeshop
- Blueprint yang jadi acuan: dokumen Enterprise Architecture Blueprint v2.0 (12 bulan roadmap)
- Progress aktual saat ini: sekitar 18 persen dari total blueprint
- Presentasi ini berisi: perbandingan arsitektur, progress per modul, gap kritis, dan rencana implementasi ke depan""")

# ══════════════════════════════════════════════════════════════
# SLIDE 2 — EXECUTIVE SUMMARY
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Executive Summary", "Blueprint v2.0 — 12 Bulan Roadmap vs Realitas Codebase")
slide_number(s, 2)

bullet_box(s, Inches(0.5), Inches(1.4), Inches(6.0), Inches(3.0),
           "Blueprint Vision (Target)", [
               "Modular Monolith \u2192 Microservices-ready",
               "PWA-First customer experience (QR \u2192 Order)",
               "Event-driven architecture (RabbitMQ)",
               "5 Modul: E-Menu, POS, Reservasi, Inventori, Akuntansi",
               "Enterprise: observability, security, DevOps, multi-outlet",
               "Stack: Next.js 14 · NestJS 10 · Prisma · Redis · K8s",
           ], title_color=RED)

bullet_box(s, Inches(6.8), Inches(1.4), Inches(6.0), Inches(3.0),
           "Current Reality (Actual)", [
               "Express.js monolith (JavaScript)",
               "Admin dashboard functional (7 views)",
               "Realtime via Socket.io (single node)",
               "ZERO customer-facing PWA",
               "ZERO Inventori & Akuntansi modules",
               "ZERO enterprise infrastructure",
           ], title_color=MOCHA)

# Verdict box
add_rounded(s, Inches(0.5), Inches(4.7), Inches(12.3), Inches(1.3), DARK)
add_text(s, Inches(0.8), Inches(4.85), Inches(11.7), Inches(0.4),
         "VERDICT", size=16, color=RED, bold=True)
add_text(s, Inches(0.8), Inches(5.25), Inches(11.7), Inches(0.6),
         "Solid MVP backend untuk operasional internal. Customer-facing PWA dan seluruh modul v2 "
         "(Inventori, Akuntansi, Enterprise Infra) BELUM dimulai. Posisi \u2248 bulan 2-3 dari Fase 1-2.",
         size=15, color=CREAM)

add_notes(s, """SLIDE 2 - EXECUTIVE SUMMARY

Jelaskan dua kolom secara berdampingan:

KIRI (Blueprint Vision) - Ini target yang kita tuju:
- Arsitektur modular yang siap dipecah jadi microservices saat skala menuntut
- Pelanggan bisa pesan langsung lewat QR code tanpa install aplikasi
- Semua modul saling berkomunikasi lewat event, bukan panggilan langsung
- 5 modul utama: E-Menu, POS, Reservasi, Inventori, Akuntansi
- Infrastruktur enterprise lengkap: monitoring, keamanan, CI/CD, multi-outlet

KANAN (Current Reality) - Ini kondisi sekarang:
- Backend sudah berjalan dengan Express.js
- Dashboard admin sudah fungsional dengan 7 view
- Realtime sudah jalan via Socket.io
- TAPI: customer-facing PWA nol, modul Inventori nol, modul Akuntansi nol

KESIMPULAN (kotak bawah): Backend untuk operasional internal sudah solid,
tapi sisi customer dan modul bisnis kritis (inventori + akuntansi) belum dimulai.
Posisi kita sekitar bulan 2-3 dari roadmap 12 bulan.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 3 — ARCHITECTURE COMPARISON
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Perbandingan Arsitektur", "Target Blueprint vs Implementasi Saat Ini")
slide_number(s, 3)

# Target
add_text(s, Inches(0.5), Inches(1.3), Inches(6), Inches(0.4),
         "TARGET BLUEPRINT", size=16, color=RED, bold=True)
layers_target = [
    ("CLIENT: Next.js 14 PWA + POS + Admin", COFFEE),
    ("EDGE: Cloudflare CDN/WAF/Rate-Limit", CARAMEL),
    ("APP: NestJS Modular (Catalog/Order/Table/Payment/Auth)", CARAMEL),
    ("EVENT: RabbitMQ + BullMQ + WebSocket Cluster", MOCHA),
    ("DATA: PostgreSQL + Redis + S3 + TimescaleDB", RGBColor(0x5D, 0x7A, 0x5D)),
    ("OPS: Docker + K8s + ArgoCD + OTel + Grafana", GRAY),
]
y = Inches(1.7)
for label, color in layers_target:
    add_rounded(s, Inches(0.5), y, Inches(5.8), Inches(0.5), color)
    add_text(s, Inches(0.7), y + Inches(0.05), Inches(5.4), Inches(0.4),
             label, size=12, color=WHITE, bold=True)
    y += Inches(0.6)

# Actual
add_text(s, Inches(7.0), Inches(1.3), Inches(6), Inches(0.4),
         "IMPLEMENTASI AKTUAL", size=16, color=MOCHA, bold=True)
layers_actual = [
    ("CLIENT: Vanilla HTML/CSS/JS (admin only)", LATTE),
    ("EDGE: Tidak ada (langsung Express)", LATTE),
    ("APP: Express.js monolith (routes/ + middleware/)", CARAMEL),
    ("EVENT: In-memory eventBus.js (hilang saat restart)", RGBColor(0x8B, 0x45, 0x13)),
    ("DATA: PostgreSQL only (raw SQL, no cache)", RGBColor(0x5D, 0x7A, 0x5D)),
    ("OPS: node server.js (no container, no CI/CD)", LATTE),
]
y = Inches(1.7)
for label, color in layers_actual:
    add_rounded(s, Inches(7.0), y, Inches(5.8), Inches(0.5), color)
    add_text(s, Inches(7.2), y + Inches(0.05), Inches(5.4), Inches(0.4),
             label, size=12, color=WHITE, bold=True)
    y += Inches(0.6)

# Key insight
add_rounded(s, Inches(0.5), Inches(5.5), Inches(12.3), Inches(1.2), DARK)
add_text(s, Inches(0.8), Inches(5.6), Inches(11.7), Inches(0.4),
         "KEY INSIGHT", size=14, color=RED, bold=True)
add_text(s, Inches(0.8), Inches(6.0), Inches(11.7), Inches(0.5),
         "Backend logic sudah ada fondasi yang baik (auth, orders, reservations). Gap terbesar: "
         "Customer PWA (0%), Inventori (0%), Accounting (0%), dan Infrastructure (0%).",
         size=14, color=CREAM)

add_notes(s, """SLIDE 3 - PERBANDINGAN ARSITEKTUR

Bandingkan 6 lapisan dari atas ke bawah:

TARGET (kiri):
1. Client - Next.js 14 PWA (customer + POS + admin) vs Aktual: hanya admin HTML vanilla
2. Edge - Cloudflare CDN/WAF/Rate-Limit vs Aktual: tidak ada, request langsung ke Express
3. Application - NestJS modular terstruktur vs Aktual: Express.js monolith
4. Event - RabbitMQ + BullMQ + WebSocket cluster vs Aktual: eventBus.js in-memory (hilang saat restart)
5. Data - PostgreSQL + Redis + S3 + TimescaleDB vs Aktual: PostgreSQL saja, tanpa cache
6. Ops - Docker + Kubernetes + ArgoCD + OpenTelemetry vs Aktual: node server.js manual

KEY INSIGHT: Fondasi backend (auth, orders, reservations) sudah bagus.
Gap terbesar ada di 4 area: Customer PWA, Inventori, Accounting, Infrastructure - semuanya 0 persen.

Sorot bahwa lapisan Data dan Event adalah fondasi yang harus dibangun dulu sebelum modul lain bisa jalan.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 4 — TECH STACK STATUS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Technology Stack Status", "Target Blueprint vs Kondisi Aktual")
slide_number(s, 4)

rows = [
    ["Layer", "Blueprint Target", "Aktual", "Status"],
    ["Runtime", "Node.js 20 + NestJS 10", "Node.js 20 + Express.js", "\u25CF Sebagian"],
    ["Language", "TypeScript 5", "JavaScript (CommonJS)", "\u25CF Tidak"],
    ["Frontend", "Next.js 14 (App Router)", "Vanilla HTML/CSS/JS", "\u25CF Tidak"],
    ["ORM", "Prisma 5", "Raw SQL (pg driver)", "\u25CF Sebagian"],
    ["Database", "PostgreSQL 15 + Read Replica", "PostgreSQL 15 (single)", "\u25CF Sebagian"],
    ["Cache", "Redis 7 Cluster", "Tidak ada", "\u25CF Tidak"],
    ["Event Bus", "RabbitMQ / Kafka", "In-memory eventBus.js", "\u25CF Tidak"],
    ["Job Queue", "BullMQ (Redis)", "Tidak ada", "\u25CF Tidak"],
    ["Realtime", "Socket.io + Redis Adapter", "Socket.io (single node)", "\u25CF Sebagian"],
    ["Auth", "Passport + JWT + TOTP (MFA)", "Custom JWT + Bcrypt", "\u25CF 85%"],
    ["Validation", "class-validator + Zod", "Manual checks", "\u25CF Tidak"],
    ["Container", "Docker (distroless)", "Tidak ada", "\u25CF Tidak"],
    ["Orchestration", "Kubernetes (EKS/GKE)", "Tidak ada", "\u25CF Tidak"],
    ["CI/CD", "GitHub Actions + ArgoCD", "Tidak ada", "\u25CF Tidak"],
    ["Observability", "OpenTelemetry + Grafana + Loki", "console.log", "\u25CF Tidak"],
    ["Payment", "Midtrans / Xendit", "Stub (belum terintegrasi)", "\u25CF Tidak"],
]
add_table(s, Inches(0.5), Inches(1.3), Inches(12.3), rows,
          [2, 4, 4, 2], font_size=11)

add_notes(s, """SLIDE 4 - TECHNOLOGY STACK STATUS

Tabel ini membandingkan 17 layer teknologi. Tekankan 3 kategori:

SUDAH ADA (walaupun beda dengan target):
- Runtime: Express.js bukan NestJS - bisa dipakai sementara, tapi perlu migrasi untuk modularity
- Database: PostgreSQL sudah jalan - ini fondasi yang baik
- Auth: JWT + Bcrypt sudah solid - bahkan lebih dari 85 persen
- Realtime: Socket.io sudah jalan - tinggal tambah Redis adapter untuk scaling

BELUM ADA (yang paling kritis):
- Frontend framework: masih vanilla HTML/CSS, harus migrasi ke Next.js untuk PWA
- Redis: tanpa ini tidak ada cache, job queue, dan distributed session
- RabbitMQ: event bus in-memory tidak reliable untuk production
- Docker + Kubernetes: deployment masih manual
- Observability: console.log saja - tidak bisa debug production
- Payment: Midtrans masih stub - belum bisa terima pembayaran nyata

Kesimpulan: dari 17 layer, 4 sudah sebagian, 13 belum ada.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 5 — MODULE PROGRESS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Progress per Modul Blueprint", "Berdasarkan analisis source code vs spesifikasi blueprint v2.0")
slide_number(s, 5)

modules = [
    ("Auth & RBAC", 85, GREEN, "JWT + refresh rotation, 5 role, middleware, CRUD user"),
    ("Modul 1: E-Menu (Customer PWA)", 5, RGBColor(0x8B, 0x45, 0x13), "0 kode customer PWA, no SW, no offline, no QR flow"),
    ("Modul 2: POS Dashboard", 45, YELLOW, "Order queue + realtime \u2713; KDS/shift/offline \u2717"),
    ("Modul 3: Reservasi", 35, ORANGE, "Backend API + DB \u2713; Customer UI/webhook/reminder \u2717"),
    ("Modul 4: Inventori", 0, RGBColor(0x8B, 0x45, 0x13), "0 tabel, 0 route, 0 logic"),
    ("Modul 5: Akuntansi", 0, RGBColor(0x8B, 0x45, 0x13), "0 tabel, 0 route, 0 logic"),
    ("Event-Driven Architecture", 15, RGBColor(0x8B, 0x45, 0x13), "In-memory only, no persistence/retry/DLQ"),
    ("Realtime (WebSocket)", 40, YELLOW, "Socket.io single node, no Redis adapter"),
    ("Cache & Performance", 10, RGBColor(0x8B, 0x45, 0x13), "In-memory rate limit, no Redis, no read replica"),
    ("Observability", 0, RGBColor(0x8B, 0x45, 0x13), "console.log only, no tracing/metrics/log aggregation"),
    ("Security & Compliance", 20, ORANGE, "Bcrypt + JWT \u2713; no audit trail, no Vault, no WAF"),
    ("DevOps & Infrastructure", 0, RGBColor(0x8B, 0x45, 0x13), "No Docker, no K8s, no CI/CD, no GitOps"),
    ("Multi-Outlet", 0, RGBColor(0x8B, 0x45, 0x13), "Hardcoded outlet_id = 1"),
]

y = Inches(1.35)
for name, pct, color, desc in modules:
    # Module name
    add_text(s, Inches(0.5), y, Inches(3.0), Inches(0.32),
             name, size=12, color=BLACK, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    # Bar background
    add_rounded(s, Inches(3.6), y + Inches(0.04), Inches(5.5), Inches(0.26), BEIGE)
    # Bar fill
    bar_w = max(int(Inches(5.5) * pct / 100), Inches(0.1))
    if pct > 0:
        add_rounded(s, Inches(3.6), y + Inches(0.04), bar_w, Inches(0.26), color)
    # Percentage
    add_text(s, Inches(9.2), y, Inches(0.6), Inches(0.32),
             f"{pct}%", size=13, color=color, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    # Description
    add_text(s, Inches(9.9), y, Inches(3.0), Inches(0.32),
             desc, size=10, color=GRAY, anchor=MSO_ANCHOR.MIDDLE)
    y += Inches(0.4)

add_notes(s, """SLIDE 5 - PROGRESS PER MODUL

Ini slide paling penting - visual progress 13 area dalam bentuk bar chart.

YANG SUDAH BAGUS:
- Auth & RBAC 85 persen: JWT access+refresh, 5 role hierarchy, middleware, CRUD user
- POS Dashboard 45 persen: order queue + realtime jalan, tapi KDS/shift/offline belum
- Realtime 40 persen: Socket.io single node, belum Redis adapter untuk scaling
- Reservasi 35 persen: backend API + database lengkap, tapi UI customer + webhook + reminder belum

YANG MASIH RENDAH / NOL:
- Customer PWA 5 persen: ini gap TERBESAR - tanpa PWA, pelanggan tidak bisa pesan online
- Inventori 0 persen: belum ada tabel, route, atau logic sama sekali
- Akuntansi 0 persen: belum ada COA, journal, laporan keuangan
- Observability 0 persen: console.log saja
- DevOps 0 persen: tidak ada container, CI/CD, atau GitOps
- Multi-outlet 0 persen: masih hardcoded outlet_id = 1

Poin pembicaraan: modul dengan 0 persen adalah modul yang PALING BESAR cakupannya
di blueprint - terutama Inventori dan Akuntansi yang jadi fondasi siklus bisnis.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 6 — DATABASE SCHEMA COVERAGE
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Database Schema Coverage", "Tabel yang sudah ada vs tabel yang belum dibuat")
slide_number(s, 6)

bullet_box(s, Inches(0.5), Inches(1.3), Inches(6.0), Inches(2.8),
           "\u2713 SUDAH ADA (schema.sql)", [
               "categories, menu_items \u2014 katalog dasar",
               "orders, order_items \u2014 manajemen pesanan",
               "users, refresh_tokens \u2014 auth & RBAC",
               "payments \u2014 catatan pembayaran (stub)",
               "reservations, reservation_tables, time_slots",
               "pre_orders, pre_order_items, deposit_payments",
               "verification_logs, tables",
           ], title_color=GREEN)

bullet_box(s, Inches(6.8), Inches(1.3), Inches(6.0), Inches(2.8),
           "\u2717 BELUM ADA (Blueprint v2.0)", [
               "ingredients, recipes, recipe_lines, stock_movements \u2014 Inventori",
               "suppliers, purchase_orders, po_lines, goods_receipts \u2014 Procurement",
               "stock_opnames \u2014 Stock take",
               "accounts, journal_entries, journal_lines, ledger_entries \u2014 Akuntansi",
               "fiscal_periods, financial_reports, tax_configs \u2014 Reporting",
               "outlet_operational \u2014 Multi-outlet",
               "audit_trails \u2014 Immutable audit log",
           ], title_color=RGBColor(0x8B, 0x45, 0x13))

# Stats
stats = [
    ("13", "Tabel\nSudah Ada", GREEN),
    ("20+", "Tabel\nBelum Ada", RGBColor(0x8B, 0x45, 0x13)),
    ("~40%", "Schema\nCoverage", YELLOW),
]
x = Inches(2.0)
for num, label, color in stats:
    add_rounded(s, x, Inches(4.5), Inches(3.0), Inches(2.2), WHITE)
    add_text(s, x, Inches(4.7), Inches(3.0), Inches(1.0),
             num, size=48, color=color, bold=True, align=PP_ALIGN.CENTER)
    add_text(s, x, Inches(5.7), Inches(3.0), Inches(0.8),
             label, size=15, color=BLACK, align=PP_ALIGN.CENTER)
    x += Inches(3.5)

add_notes(s, """SLIDE 6 - DATABASE SCHEMA COVERAGE

KIRI - 13 tabel yang SUDAH ADA:
- categories + menu_items: katalog menu (nama, harga, foto, ketersediaan)
- orders + order_items: pesanan pelanggan dengan queue number harian
- users + refresh_tokens: autentikasi dan RBAC
- payments: catatan pembayaran (belum terintegrasi gateway)
- Reservasi lengkap: reservations, reservation_tables, time_slots, pre_orders, deposit_payments, verification_logs
- tables: master data meja

KANAN - 20+ tabel yang BELUM ADA:
- Inventori: ingredients, recipes, recipe_lines, stock_movements, suppliers, purchase_orders, goods_receipts, stock_opnames
- Akuntansi: accounts (COA), journal_entries, journal_lines, ledger_entries, fiscal_periods, financial_reports, tax_configs
- Multi-outlet: outlet_operational
- Keamanan: audit_trails (immutable log)

STATISTIK: 13 tabel sudah ada, 20+ belum, coverage sekitar 40 persen.

Poin: tabel reservasi sudah lengkap strukturnya - ini modal bagus.
Yang paling kritis ditambahkan: tabel inventori (karena akuntansi butuh data stok untuk HPP).""")

# ══════════════════════════════════════════════════════════════
# SLIDE 7 — API ENDPOINTS STATUS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "API Endpoints Status", "Endpoint yang sudah diimplementasi vs yang belum")
slide_number(s, 7)

rows = [
    ["Domain", "Sudah Diimplementasi", "Belum Ada"],
    ["Auth", "/register, /login, /refresh, /logout, /me, /users CRUD", "MFA, password reset, session mgmt"],
    ["Menu", "/menu, /menu/categories, CRUD admin", "Search, variants, addons, real-time availability"],
    ["Orders", "POST, GET staff, /live-queue, /status, PATCH status", "KDS view, shift mgmt, cash drawer, offline sync"],
    ["Reservasi", "GET/POST/DELETE, /live, /pay, /checkin", "Customer booking form, Midtrans webhook, reminders, QR"],
    ["Payments", "POST create, webhook stub", "Midtrans integration, VA/E-Wallet, refund, settlement"],
    ["Reports", "/reports/daily", "P&L, Cash Flow, Neraca, export PDF/Excel, konsolidasi"],
    ["Tables", "CRUD lengkap", "Table map visual, QR per meja"],
    ["Inventori", "\u2014 TIDAK ADA \u2014", "Semua endpoint inventori"],
    ["Akuntansi", "\u2014 TIDAK ADA \u2014", "Semua endpoint akuntansi"],
]
add_table(s, Inches(0.5), Inches(1.3), Inches(12.3), rows,
          [1.5, 5, 5.5], font_size=12)

add_notes(s, """SLIDE 7 - API ENDPOINTS STATUS

Tabel membandingkan endpoint yang sudah ada vs yang belum, per domain:

SUDAH JALAN:
- Auth: register, login, refresh, logout, me, users CRUD (owner only) - paling lengkap
- Menu: browse publik + CRUD admin - fungsional
- Orders: submit (publik), list (staff), live-queue, status, PATCH status - inti POS berjalan
- Reservasi: booking, check-in, pay, live queue - backend lengkap
- Tables: CRUD lengkap

BELUM ADA / STUB:
- Payments: baru create + webhook stub - Midtrans belum terintegrasi
- Reports: baru daily summary - P&L, Cash Flow, Neraca, export PDF/Excel belum ada
- Inventori: SEMUA endpoint belum ada
- Akuntansi: SEMUA endpoint belum ada

Fitur pendukung yang hilang:
- Menu: search, variants (ukuran), addons (tambahan), real-time availability
- Orders: KDS view, shift management, cash drawer, offline sync
- Reservasi: booking form customer, webhook Midtrans, reminder, QR check-in generation""")

# ══════════════════════════════════════════════════════════════
# SLIDE 8 — FRONTEND STATUS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Frontend Status", "Admin Dashboard vs Customer PWA")
slide_number(s, 8)

bullet_box(s, Inches(0.5), Inches(1.3), Inches(6.0), Inches(4.5),
           "\u2713 ADMIN DASHBOARD (admin.html + admin.js) \u2014 FUNGSIONAL", [
               "Login JWT + HttpOnly cookie",
               "7 views: Orders, Reservations, Payments, Menu, Tables, Reports, Users",
               "Real-time Socket.io (order:new, order:status, catalog:updates)",
               "Role-based nav visibility (owner/manager \u2192 Menu & Users)",
               "CRUD modals untuk Menu, Tables, Users",
               "Status transitions: baru \u2192 diproses \u2192 siap \u2192 selesai",
               "Check-in untuk reservasi",
               "Daily reports dengan filter tanggal",
               "502 baris JavaScript vanilla",
           ], title_color=GREEN, size=13)

bullet_box(s, Inches(6.8), Inches(1.3), Inches(6.0), Inches(4.5),
           "\u2717 CUSTOMER PWA \u2014 TIDAK ADA", [
               "Tidak ada halaman customer menu",
               "Service Worker kosong/placeholder",
               "Tidak ada manifest installability",
               "Tidak ada IndexedDB untuk offline cart",
               "Tidak ada Background Sync",
               "Tidak ada QR session validation",
               "Tidak ada push notification (FCM/VAPID)",
               "Tidak ada checkout flow",
               "Tidak ada order tracking page",
               "checkin.html = placeholder kosong",
           ], title_color=RGBColor(0x8B, 0x45, 0x13), size=13)

# Score
add_rounded(s, Inches(4.5), Inches(6.1), Inches(4.3), Inches(0.9), DARK)
add_text(s, Inches(4.5), Inches(6.2), Inches(4.3), Inches(0.7),
         "Admin: \u2713 85%    |    Customer: \u2717 0%", size=18, color=RED,
         bold=True, align=PP_ALIGN.CENTER)

add_notes(s, """SLIDE 8 - FRONTEND STATUS

Ini adalah kontras paling mencolok dalam seluruh presentasi.

KIRI - ADMIN DASHBOARD (85 persen, FUNGSIONAL):
- Login JWT dengan HttpOnly cookie (aman dari XSS)
- 7 view: Orders, Reservations, Payments, Menu, Tables, Reports, Users
- Realtime: order baru langsung muncul tanpa refresh (Socket.io)
- Role-based: owner/manager lihat menu & users, barista/cashier hanya orders
- CRUD lengkap untuk menu, meja, dan user
- Status flow: baru - diproses - siap - selesai
- 502 baris JavaScript vanilla yang berfungsi baik

KANAN - CUSTOMER PWA (0 persen, TIDAK ADA):
- Tidak ada halaman menu untuk pelanggan
- Service Worker kosong - tidak bisa offline
- Tidak ada IndexedDB - cart tidak tersimpan
- Tidak ada Background Sync - order hilang kalau koneksi putus
- Tidak ada QR session - siapa pun bisa akses tanpa validasi
- Tidak ada push notification - pelanggan tidak tahu pesanan siap

GARIS BAWAH: Admin 85 persen, Customer 0 persen.
Padahal customer adalah yang menghasilkan revenue.
Ini prioritas #1 untuk ditutup.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 9 — CRITICAL GAPS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Critical Gaps \u2014 Blockers for Blueprint", "Gap yang harus ditutup untuk mencapai blueprint v2.0")
slide_number(s, 9)

rows = [
    ["Gap", "Impact", "Effort"],
    ["Tidak ada Customer PWA", "Zero revenue channel; core value prop hilang", "HIGH (4-6 minggu)"],
    ["Tidak ada Midtrans Integration", "Tidak bisa terima pembayaran nyata", "MEDIUM (1-2 minggu)"],
    ["Tidak ada Redis", "No distributed cache, rate limit, job queue", "MEDIUM (1-2 minggu)"],
    ["Tidak ada BullMQ/Scheduler", "No background jobs (reminder, auto-cancel)", "MEDIUM (2 minggu)"],
    ["EventBus in-memory", "Events hilang saat restart; no replay/DLQ", "MEDIUM (2 minggu)"],
    ["Modul Inventori kosong", "Tidak bisa auto-decrement stok, no COGS", "HIGH (3-4 minggu)"],
    ["Modul Akuntansi kosong", "No laporan keuangan, no audit trail", "HIGH (4-5 minggu)"],
    ["Tidak ada Observability", "Tidak bisa debug production, no SLA monitor", "MEDIUM (2-3 minggu)"],
    ["Tidak ada Container/Infra", "Manual deploy, no scaling, no blue-green", "HIGH (3-4 minggu)"],
    ["Multi-outlet hardcoded", "Tidak bisa scale ke franchise", "LOW (refactor)"],
]
add_table(s, Inches(0.5), Inches(1.3), Inches(12.3), rows,
          [4, 5, 3], font_size=13)

add_notes(s, """SLIDE 9 - CRITICAL GAPS

10 gap utama diurutkan berdasarkan dampak. Jelaskan 3 kategori effort:

HIGH EFFORT (3-6 minggu masing-masing):
1. Tidak ada Customer PWA - tanpa ini, pelanggan tidak bisa pesan online sama sekali. Ini gap paling kritis karena menyangkut revenue channel.
2. Modul Inventori kosong - tanpa ini, stok tidak otomatis berkurang, HPP tidak bisa dihitung
3. Modul Akuntansi kosong - tanpa ini, tidak ada laporan keuangan sama sekali
4. Tidak ada Container/Infra - deployment manual, tidak bisa scale

MEDIUM EFFORT (1-3 minggu masing-masing):
5. Tidak ada Midtrans - belum bisa terima pembayaran QRIS/VA/E-Wallet
6. Tidak ada Redis - tidak ada distributed cache dan job queue
7. Tidak ada BullMQ - reminder reservasi, auto-cancel hold tidak jalan
8. EventBus in-memory - event hilang saat server restart
9. Tidak ada Observability - tidak bisa debug masalah di production

LOW EFFORT:
10. Multi-outlet hardcoded - tinggal refactor jadi per-outlet

Urutan penyelesaian: yang HIGH dulu karena paling lama, yang MEDIUM bisa paralel.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 10 — ARCHITECTURE DECISIONS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Architecture Decisions Needed", "Keputusan teknologi yang harus diambil")
slide_number(s, 10)

rows = [
    ["Keputusan", "Opsi", "Rekomendasi"],
    ["Frontend", "Vanilla JS \u2192 Next.js 14 (App Router)", "Next.js 14 \u2014 SSR, RSC, PWA, API routes"],
    ["Backend", "Express \u2192 NestJS 10", "NestJS \u2014 Modular, DI, siap microservices"],
    ["ORM", "Raw SQL \u2192 Prisma 5", "Prisma \u2014 Type-safe, migration, relation"],
    ["Event Bus", "In-memory \u2192 RabbitMQ", "RabbitMQ \u2014 Low complexity, persistent"],
    ["Cache/Queue", "None \u2192 Redis 7 Cluster", "Redis \u2014 Session, cache, BullMQ, WS adapter"],
    ["Payment", "Stub \u2192 Midtrans/Xendit", "Midtrans \u2014 QRIS/VA/E-Wallet, Indonesia"],
    ["Notifikasi", "None \u2192 FCM + Wablas + SendGrid", "FCM (push) + Wablas (WA) + SendGrid (email)"],
    ["Deployment", "Bare metal \u2192 Docker + K8s + ArgoCD", "Docker + K8s + GitOps, blue-green, HPA"],
    ["Observability", "console.log \u2192 OTel + Prometheus + Grafana", "Full OTel stack \u2014 distributed tracing"],
]
add_table(s, Inches(0.5), Inches(1.3), Inches(12.3), rows,
          [2, 4.5, 5.5], font_size=13)

add_notes(s, """SLIDE 10 - ARCHITECTURE DECISIONS

9 keputusan teknologi yang harus diambil sebelum mulai development. Jelaskan alasannya:

1. Frontend: Vanilla JS - Next.js 14. Alasan: SSR untuk SEO menu publik, React Server Components untuk performa, built-in PWA support
2. Backend: Express - NestJS 10. Alasan: modular structure dengan dependency injection, mudah dipecah jadi microservices nanti
3. ORM: Raw SQL - Prisma 5. Alasan: type-safe, migration aman, relasi jelas
4. Event Bus: In-memory - RabbitMQ. Alasan: persistent (event tidak hilang saat restart), ada retry mechanism
5. Cache: None - Redis 7. Alasan: sekaligus untuk session, cache, rate limit, BullMQ job queue, dan WebSocket adapter
6. Payment: Stub - Midtrans. Alasan: dukung QRIS, VA, E-Wallet, cocok untuk pasar Indonesia, sudah PCI-DSS compliant
7. Notifikasi: None - FCM + Wablas + SendGrid. Alasan: push notification, WhatsApp (populer di Indonesia), email
8. Deployment: Bare metal - Docker + K8s + ArgoCD. Alasan: container consistency, auto-scaling, GitOps deployment
9. Observability: console.log - OpenTelemetry stack. Alasan: distributed tracing lintas modul, metrics, alerting

Poin: keputusan 1-5 adalah fondasi teknis, keputusan 6-9 adalah kebutuhan operasional.
Yang paling urgent: Redis (kebutuhan banyak modul) dan Midtrans (revenue channel).""")

# ══════════════════════════════════════════════════════════════
# SLIDE 11 — IMPLEMENTATION PHASES
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Recommended Implementation Phases", "6 fase untuk mencapai Blueprint v2.0")
slide_number(s, 11)

phases = [
    ("PHASE 0: Foundation", "2 minggu", "Dockerize, Redis, BullMQ, RabbitMQ, basic observability",
     ESPRESSO),
    ("PHASE 1: Customer PWA MVP", "4-6 minggu", "Next.js 14, PWA, QR session, cart, Midtrans, order tracking",
     RED),
    ("PHASE 2: Payment & Reservasi", "2-3 minggu", "Midtrans webhook, booking UI, QR check-in, WA reminder, auto-cancel",
     ORANGE),
    ("PHASE 3: Inventori Module", "3-4 minggu", "BOM, stock ledger, PO/GRN, opname, auto-decrement, alerts",
     YELLOW),
    ("PHASE 4: Akuntansi Module", "4-5 minggu", "COA, auto-journal, P&L/CF/Neraca, period close, export",
     GREEN),
    ("PHASE 5: Enterprise Hardening", "3-4 minggu", "NestJS, K8s, GitOps, observability, security, DR, load test",
     RGBColor(0x4A, 0x30, 0x40)),
]

y = Inches(1.4)
for i, (name, dur, desc, color) in enumerate(phases):
    # Phase box
    add_rounded(s, Inches(0.5), y, Inches(9.5), Inches(0.85), WHITE)
    # Color stripe
    add_rect(s, Inches(0.5), y, Inches(0.15), Inches(0.85), color)
    # Text
    add_text(s, Inches(0.9), y + Inches(0.05), Inches(6.5), Inches(0.35),
             name, size=16, color=color, bold=True)
    add_text(s, Inches(0.9), y + Inches(0.42), Inches(8.8), Inches(0.35),
             desc, size=12, color=GRAY)
    # Duration badge
    add_rounded(s, Inches(10.3), y + Inches(0.2), Inches(2.2), Inches(0.45), color)
    add_text(s, Inches(10.3), y + Inches(0.25), Inches(2.2), Inches(0.35),
             dur, size=13, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
    y += Inches(0.95)

add_notes(s, """SLIDE 11 - IMPLEMENTATION PHASES

6 fase implementasi berurutan, total sekitar 23 minggu:

PHASE 0 - FOUNDATION (2 minggu):
Dockerize aplikasi, tambah Redis (session+cache+rate limit), BullMQ untuk background jobs,
RabbitMQ untuk event bus yang reliable, dan observability dasar.
Kenapa duluan? Karena semua fase berikutnya butuh infrastruktur ini.

PHASE 1 - CUSTOMER PWA MVP (4-6 minggu):
Bikin Next.js 14 project baru. Fitur: QR session, browse menu, cart, checkout via Midtrans,
order tracking realtime, push notification, offline support. Ini fase paling lama karena
membangun dari nol.

PHASE 2 - PAYMENT & RESERVASI (2-3 minggu):
Integrasi Midtrans webhook (idempotent), UI booking form customer, QR check-in,
reminder WhatsApp H-1/H-2 jam, auto-cancel hold 30 menit.

PHASE 3 - INVENTORI (3-4 minggu):
BOM/recipe management, auto-decrement stok saat order paid, low-stock alert,
PO/GRN workflow, stock opname.

PHASE 4 - AKUNTANSI (4-5 minggu):
COA sesuai PSAK, auto-journal dari event bisnis, double-entry validation,
P&L/Cash Flow/Neraca, period closing, export PDF/Excel.

PHASE 5 - ENTERPRISE HARDENING (3-4 minggu):
Migrasi ke NestJS, Kubernetes, GitOps (ArgoCD), full observability,
load test, security hardening, disaster recovery.

Ketergantungan: Phase 1 butuh Phase 0. Phase 4 butuh Phase 3 (HPP dari stok).
Phase 5 bisa dimulai paralel dari Phase 3.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 12 — TIMELINE & RESOURCES
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Resource & Timeline Estimate", "Estimasi percepatan dari 12 bulan menjadi ~6 bulan")
slide_number(s, 12)

rows = [
    ["Phase", "Durasi", "Tim", "Key Deliverable"],
    ["Phase 0: Foundation", "2 minggu", "2 BE", "Docker, Redis, RabbitMQ, BullMQ, observability dasar"],
    ["Phase 1: Customer PWA", "5 minggu", "2 FE + 1 BE", "PWA terima order nyata via Midtrans"],
    ["Phase 2: Reservasi Complete", "3 minggu", "1 FE + 1 BE", "Booking + DP + check-in + reminder end-to-end"],
    ["Phase 3: Inventori", "4 minggu", "2 BE + 1 FE", "Auto stock decrement, PO/GRN, opname, alerts"],
    ["Phase 4: Akuntansi", "5 minggu", "2 BE + 1 FE", "COA, auto-journal, P&L/CF/Neraca, export"],
    ["Phase 5: Hardening", "4 minggu", "2 DevOps + 1 BE", "K8s, GitOps, observability, security, DR"],
    ["TOTAL", "~23 minggu (6 bln)", "4-5 engineer", "Blueprint v2.0 Feature Complete"],
]
add_table(s, Inches(0.5), Inches(1.3), Inches(12.3), rows,
          [3, 2, 2.5, 5], font_size=13)

add_rounded(s, Inches(0.5), Inches(5.5), Inches(12.3), Inches(1.2), DARK)
add_text(s, Inches(0.8), Inches(5.65), Inches(11.7), Inches(0.4),
         "CATATAN", size=14, color=RED, bold=True)
add_text(s, Inches(0.8), Inches(6.05), Inches(11.7), Inches(0.5),
         "Blueprint original: 12 bulan. Dipercepat menjadi ~6 bulan karena auth, orders, "
         "reservations backend SUDAH ADA dan bisa direuse.",
         size=14, color=CREAM)

add_notes(s, """SLIDE 12 - RESOURCE & TIMELINE ESTIMATE

Estimasi detail per fase:

Fase 0 (2 minggu, 2 backend engineer): Docker, Redis, RabbitMQ, BullMQ, observability dasar
Fase 1 (5 minggu, 2 frontend + 1 backend): Customer PWA sampai bisa terima order nyata
Fase 2 (3 minggu, 1 frontend + 1 backend): Reservasi end-to-end dengan payment
Fase 3 (4 minggu, 2 backend + 1 frontend): Inventori dengan auto-decrement
Fase 4 (5 minggu, 2 backend + 1 frontend): Akuntansi dengan laporan keuangan
Fase 5 (4 minggu, 2 DevOps + 1 backend): Kubernetes, GitOps, observability, security

TOTAL: sekitar 23 minggu (6 bulan) dengan 4-5 engineer

KUNCI PERCEPATAN (kotak bawah):
Blueprint asli 12 bulan. Bisa dipercepat jadi 6 bulan karena:
- Auth backend SUDAH ADA (tidak perlu tulis ulang)
- Orders backend SUDAH ADA (tinggal tambah KDS & shift)
- Reservations backend SUDAH ADA (tinggal UI & webhook)
- Database schema reservasi SUDAH LENGKAP

Artinya kita tidak mulai dari nol - fondasi yang sudah ada menghemat sekitar 6 bulan kerja.

Catatan untuk stakeholder: butuh komitmen 4-5 engineer selama 6 bulan penuh.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 13 — RISK & MITIGATION
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Risk & Mitigation", "Risiko utama dan strategi mitigasi")
slide_number(s, 13)

rows = [
    ["Risiko", "Kemungkinan", "Dampak", "Mitigasi"],
    ["Midtrans sandbox \u2192 production delay", "Tinggi", "Tinggi", "Mulai integrasi Minggu 1; compliance review paralel"],
    ["PWA offline complexity", "Sedang", "Tinggi", "Pakai Workbox recipes; test offline scenarios awal"],
    ["Event-driven debugging sulit", "Sedang", "Tinggi", "correlationId tracing dari Day 1 (OpenTelemetry)"],
    ["Accounting compliance (PSAK, PDP)", "Rendah", "Kritis", "Engage akuntan eksternal validasi COA sebelum coding"],
    ["Kapasitas tim (4-5 engineer)", "Sedang", "Sedang", "Prioritaskan Phase 0-2; defer multi-outlet post-MVP"],
    ["Data migration existing \u2192 schema baru", "Sedang", "Sedang", "Migration scripts; test di staging dengan dump produksi"],
    ["Vendor lock-in (Midtrans, Cloudflare)", "Rendah", "Sedang", "Adapter pattern untuk payment, storage, CDN"],
]
add_table(s, Inches(0.5), Inches(1.3), Inches(12.3), rows,
          [3.5, 1.5, 1.5, 5.8], font_size=12)

add_notes(s, """SLIDE 13 - RISK & MITIGATION

7 risiko utama dengan strategi mitigasinya:

1. MIDTRANS SANDBAY - PRODUCTION DELAY (Kemungkinan: Tinggi, Dampak: Tinggi)
   - Bisnis account Midtrans butuh verifikasi. Mitigasi: mulai integrasi minggu 1,
     jalankan compliance review secara paralel.

2. PWA OFFLINE COMPLEXITY (Kemungkinan: Sedang, Dampak: Tinggi)
   - IndexedDB + Background Sync itu rumit. Mitigasi: pakai Workbox recipes yang sudah
     teruji, test skenario offline dari awal.

3. EVENT-DRIVEN DEBUGGING SULIT (Kemungkinan: Sedang, Dampak: Tinggi)
   - Saat banyak event saling terkait, debugging jadi sulit. Mitigasi: correlationId tracing
     dari hari pertama dengan OpenTelemetry.

4. ACCOUNTING COMPLIANCE - PSAK & UU PDP (Kemungkinan: Rendah, Dampak: Kritis)
   - Salah COA = laporan keuangan tidak sah. Mitigasi: libatkan akuntan eksternal untuk
     validasi COA SEBELUM mulai coding.

5. KAPASITAS TIM (Kemungkinan: Sedang, Dampak: Sedang)
   - 4-5 engineer untuk 6 bulan. Mitigasi: prioritaskan Phase 0-2, defer multi-outlet.

6. DATA MIGRATION (Kemungkinan: Sedang, Dampak: Sedang)
   - Data existing harus pindah ke schema baru. Mitigasi: migration scripts, test di staging.

7. VENDOR LOCK-IN (Kemungkinan: Rendah, Dampak: Sedang)
   - Terlalu bergantung Midtrans/Cloudflare. Mitigasi: adapter pattern - mudah ganti vendor.

Fokuskan pada risiko 1 dan 4 karena dampaknya paling tinggi.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 14 — IMMEDIATE NEXT STEPS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Immediate Next Steps", "Langkah konkret minggu ini")
slide_number(s, 14)

steps = [
    ("1", "Dockerize", "Container Express app + PostgreSQL dengan Docker Compose"),
    ("2", "Add Redis", "Session store, rate limit, catalog cache pindah ke Redis"),
    ("3", "Integrate Midtrans Sandbox", "Create payment + webhook handler (idempotent + signature)"),
    ("4", "Setup BullMQ", "Auto-cancel reservation hold (30 min), daily report job"),
    ("5", "Init Next.js 14", "Project baru untuk customer PWA (monorepo atau repo terpisah)"),
    ("6", "Configure OpenTelemetry", "Auto-instrument Node.js, export ke Jaeger/Tempo"),
    ("7", "Validate COA Mapping", "Diskusi chart of accounts dengan akuntan (standar PSAK)"),
    ("8", "Write ADR", "Architecture Decision Records: NestJS, Prisma, RabbitMQ, Next.js"),
]

y = Inches(1.4)
for num, title, desc in steps:
    # Number circle
    circle = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.6), y, Inches(0.55), Inches(0.55))
    circle.fill.solid()
    circle.fill.fore_color.rgb = RED
    circle.line.fill.background()
    add_text(s, Inches(0.6), y + Inches(0.07), Inches(0.55), Inches(0.4),
             num, size=18, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
    # Title
    add_text(s, Inches(1.4), y + Inches(0.02), Inches(3.5), Inches(0.35),
             title, size=16, color=BLACK, bold=True)
    # Description
    add_text(s, Inches(5.0), y + Inches(0.02), Inches(7.5), Inches(0.5),
             desc, size=14, color=GRAY)
    y += Inches(0.72)

add_notes(s, """SLIDE 14 - IMMEDIATE NEXT STEPS

8 langkah konkret yang bisa dimulai MINGGU INI:

1. DOCKERIZE - Bungkus Express app + PostgreSQL dalam Docker Compose.
   Tujuan: environment yang konsisten antara laptop developer dan server.

2. ADD Redis - Pindahkan session store, rate limit, dan catalog cache ke Redis.
   Tujuan: fondasi untuk BullMQ, distributed session, dan WebSocket scaling.

3. INTEGRATE MIDTRANS SANDBOX - Buat payment + webhook handler dengan idempotency
   dan signature verification. Tujuan: bisa test alur pembayaran end-to-end.

4. SETUP BULLMQ - Auto-cancel reservation hold setelah 30 menit, daily report job.
   Tujuan: background jobs yang reliable.

5. INIT NEXT.JS 14 - Buat project baru untuk customer PWA.
   Tujuan: mulai fondasi frontend customer yang selama ini 0 persen.

6. CONFIGURE OPENTELEMETRY - Auto-instrument Node.js, export ke Jaeger/Tempo.
   Tujuan: bisa trace request lintas modul dari awal.

7. VALIDATE COA MAPPING - Diskusi chart of accounts dengan akuntan.
   Tujuan: pastikan struktur akun benar SEBELUM coding modul akuntansi.

8. WRITE ADR - Architecture Decision Records untuk NestJS, Prisma, RabbitMQ, Next.js.
   Tujuan: dokumentasikan alasan keputusan teknologi agar tim sejalan.

Prioritas: nomor 1-4 adalah fondasi teknis, nomor 5-6 mulai paralel,
nomor 7-8 harus selesai sebelum Phase 3-4 dimulai.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 15 — FILE STRUCTURE
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Appendix: Current File Structure", "Struktur codebase yang sudah ada")
slide_number(s, 15)

tree = """odgj-street-coffee/
\u251c\u2500\u2500 server.js                  # Express entry point + rate limit + Socket.io
\u251c\u2500\u2500 config/
\u2502   \u251c\u2500\u2500 auth.js               # JWT, bcrypt, RBAC hierarchy, role permissions
\u2502   \u2514\u2500\u2500 db.js                 # pg Pool (PostgreSQL connection)
\u251c\u2500\u2500 middleware/
\u2502   \u2514\u2500\u2500 auth.js               # authenticate, requireRole, optionalAuth
\u251c\u2500\u2500 routes/
\u2502   \u251c\u2500\u2500 auth.js               # Register, login, refresh, logout, me, users CRUD
\u2502   \u251c\u2500\u2500 menu.js               # Menu CRUD, categories
\u2502   \u251c\u2500\u2500 orders.js             # Submit, list, live-queue, status, PATCH
\u2502   \u251c\u2500\u2500 reservations.js       # Booking, check-in, pay, live, CRUD
\u2502   \u251c\u2500\u2500 payments.js           # Create, webhook stub
\u2502   \u251c\u2500\u2500 reports.js            # Daily report
\u2502   \u2514\u2500\u2500 tables.js             # Table CRUD
\u251c\u2500\u2500 realtime/
\u2502   \u2514\u2500\u2500 socket.js             # Socket.io init, auth, event handlers
\u251c\u2500\u2500 events/
\u2502   \u2514\u2500\u2500 eventBus.js           # In-memory pub/sub (OrderSubmitted, dll)
\u251c\u2500\u2500 scripts/
\u2502   \u251c\u2500\u2500 setup.js              # Run schema.sql
\u2502   \u2514\u2500\u2500 seed-users.js         # Create default owner
\u251c\u2500\u2500 db/
\u2502   \u251c\u2500\u2500 schema.sql            # 13 tabel (lihat Slide 6)
\u2502   \u2514\u2500\u2500 seed.sql              # Sample categories/menu
\u251c\u2500\u2500 public/
\u2502   \u251c\u2500\u2500 admin.html            # Admin dashboard (SPA, 336 baris)
\u2502   \u251c\u2500\u2500 js/admin.js           # 502 baris: views, modals, socket, auth
\u2502   \u251c\u2500\u2500 checkin.html          # Placeholder
\u2502   \u251c\u2500\u2500 index.html            # Placeholder (belum customer PWA)
\u2502   \u251c\u2500\u2500 manifest.json         # PWA manifest (belum dipakai)
\u2502   \u2514\u2500\u2500 sw.js                 # Service worker kosong
\u2514\u2500\u2500 package.json              # Express, pg, socket.io, jwt, bcrypt"""

add_text(s, Inches(0.5), Inches(1.3), Inches(12.3), Inches(5.8),
         tree, size=13, color=BLACK, font_name="Consolas")

add_notes(s, """SLIDE 15 - APPENDIX: FILE STRUCTURE

Jelaskan struktur codebase secara singkat (ini appendix, tidak perlu detail):

KELAS SERVER:
- server.js - entry point Express + rate limiting + Socket.io init
- config/auth.js - JWT generation, bcrypt hashing, RBAC hierarchy
- config/db.js - PostgreSQL connection pool

KEAMANAN:
- middleware/auth.js - authenticate (cek token) + requireRole (cek role)

API ROUTES (7 file):
- auth, menu, orders, reservations, payments, reports, tables

REALTIME:
- realtime/socket.js - setup WebSocket + auth handler
- events/eventBus.js - in-memory pub/sub (OrderSubmitted, OrderStatusChanged, OrderReady)

DATABASE:
- db/schema.sql - 13 tabel (bisa dijalankan ulang dengan IF NOT EXISTS)
- db/seed.sql - data sample kategori dan menu

FRONTEND:
- public/admin.html + js/admin.js - dashboard admin (336 + 502 baris)
- public/index.html - placeholder (belum customer PWA)
- public/sw.js - service worker kosong

SKRIP:
- scripts/setup.js - jalankan schema.sql
- scripts/seed-users.js - buat akun owner default

Catatan: struktur ini sederhana dan cocok untuk MVP, tapi perlu reorganisasi
saat migrasi ke NestJS (Phase 5) dengan modular structure per domain.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 16 — EVENT FLOW
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Appendix: Event Flow Target", "Alur event end-to-end di Blueprint v2.0")
slide_number(s, 16)

# Flow diagram with boxes
actors = [
    ("Customer\nPWA", Inches(0.5), COFFEE),
    ("POS /\nReservation", Inches(3.3), CARAMEL),
    ("Inventory", Inches(6.5), RGBColor(0x5D, 0x7A, 0x5D)),
    ("Accounting", Inches(9.3), MOCHA),
]
y_top = Inches(1.5)
for label, x, color in actors:
    add_rounded(s, x, y_top, Inches(2.2), Inches(1.0), color)
    add_text(s, x, y_top + Inches(0.15), Inches(2.2), Inches(0.7),
             label, size=14, color=WHITE, bold=True, align=PP_ALIGN.CENTER)

# Arrows
arrows = [
    ("OrderSubmitted /\nReservationCreated", Inches(2.7), Inches(2.6)),
    ("OrderPaid /\nReservationPaid", Inches(5.6), Inches(2.6)),
    ("StockDecremented\n(COGS)", Inches(8.4), Inches(2.6)),
]
for label, x, y in arrows:
    add_text(s, x, y, Inches(2.5), Inches(0.7),
             "\u25B6 " + label, size=11, color=RED, bold=True)

# Return notification arrow
add_text(s, Inches(0.5), Inches(4.2), Inches(11), Inches(0.5),
         "\u25C0\u25C0\u25C0 Notifications (WA / Push / Email) \u2192 Customer \u25C0\u25C0\u25C0",
         size=14, color=MOCHA, bold=True, align=PP_ALIGN.CENTER)

# Event matrix
rows = [
    ["Event", "Producer", "Consumer"],
    ["OrderSubmitted", "Order Service", "POS, Notification"],
    ["OrderPaid", "Payment Service", "Inventory, Accounting, Notification"],
    ["StockDecremented", "Inventory", "Accounting (COGS)"],
    ["StockLowAlert", "Inventory", "Notification, POS (auto-disable menu)"],
    ["ReservationPaid", "Reservation", "Notification, Accounting (uang muka)"],
    ["ReservationConfirmed", "Reservation", "Table Service, Notification"],
    ["JournalPosted", "Accounting", "Reporting, Analytics"],
]
add_table(s, Inches(0.5), Inches(5.0), Inches(12.3), rows,
          [3, 3, 6], font_size=12)

add_notes(s, """SLIDE 16 - APPENDIX: EVENT FLOW TARGET

Ini adalah visi arsitektur event-driven di blueprint v2.0:

ALUR UTAMA (4 kotak di atas):
1. Customer PWA - pelanggan scan QR, pesan, bayar
   - Emit event: OrderSubmitted / ReservationCreated
2. POS / Reservation - staf terima dan proses order
   - Emit event: OrderPaid / ReservationPaid (saat pembayaran berhasil)
3. Inventory - otomatis kurangi stok bahan baku
   - Emit event: StockDecremented (dengan data HPP/COGS)
4. Accounting - otomatis catat jurnal keuangan
   - Emit event: JournalPosted (untuk modul reporting)

Notifikasi balik: setelah event diproses, sistem kirim notifikasi
(WA / Push / Email) kembali ke customer.

TABEL EVENT MATRIS (bawah):
Menunjukkan 8 event utama beserta producer dan consumer-nya.
Contoh: OrderPaid diproduksi oleh Payment Service, dikonsumsi oleh
Inventory, Accounting, dan Notification sekaligus.

Prinsip: setiap modul hanya perlu tahu "event apa yang saya dengarkan",
tanpa perlu tahu detail cara kerja modul lain (loosely coupled).

Catatan: saat ini event bus masih in-memory (hilang saat restart).
Perlu migrasi ke RabbitMQ untuk persistent dan reliable delivery.""")

# ══════════════════════════════════════════════════════════════
# SLIDE 17 — ACCOUNTING JOURNAL MAPPING
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, LIGHT_BG)
header_bar(s, "Appendix: Accounting Journal Mapping", "Kamus terjemahan event bisnis \u2192 jurnal akuntansi (PSAK)")
slide_number(s, 17)

rows = [
    ["Event Bisnis", "Debit", "Kredit"],
    ["Order Paid (QRIS)", "1-1010 Bank/QRIS", "4-1000 Pendapatan Penjualan"],
    ["\u2192 COGS (via StockDecremented)", "5-1000 HPP", "1-1200 Persediaan"],
    ["Waste Recorded", "6-2100 Beban Waste", "1-1200 Persediaan"],
    ["Purchase Received", "1-1200 Persediaan", "2-1000 Utang Usaha"],
    ["Pay Supplier", "2-1000 Utang Usaha", "1-1000 Kas"],
    ["Payroll", "6-1000 Beban Gaji", "1-1000 Kas"],
    ["Deposit Reservasi", "1-1010 Bank", "2-1300 Uang Muka Customer"],
]
add_table(s, Inches(0.5), Inches(1.3), Inches(12.3), rows,
          [4, 4, 4], font_size=14)

add_rounded(s, Inches(0.5), Inches(5.0), Inches(12.3), Inches(1.8), DARK)
add_text(s, Inches(0.8), Inches(5.15), Inches(11.7), Inches(0.4),
         "PRINSIP AKUNTANSI", size=14, color=RED, bold=True)
principles = [
    "Double-entry \u2014 setiap transaksi: total debit = total kredit (divalidasi otomatis)",
    "Immutable journal \u2014 sekali posting, tidak bisa edit; koreksi via reversal",
    "Period closing \u2014 lock periode setelah closing (mencegah backdating)",
    "Audit trail \u2014 siapa, kapan, dari event apa jurnal dibuat",
]
lines = [(f"  \u2022 {p}", CREAM, False) for p in principles]
add_multiline(s, Inches(0.8), Inches(5.55), Inches(11.7), Inches(1.1),
              lines, size=13, color=CREAM, line_spacing=1.3)

add_notes(s, """SLIDE 17 - APPENDIX: ACCOUNTING JOURNAL MAPPING

Ini "kamus terjemahan" dari bahasa operasional ke bahasa akuntansi (PSAK):

TABEL JURNAL (7 baris utama):
1. Pelanggan bayar QRIS Rp50.000:
   Debit: Bank/QRIS bertambah 50.000 | Kredit: Pendapatan Penjualan bertambah 50.000
2. COGS (biaya bahan baku terjual):
   Debit: HPP bertambah | Kredit: Persediaan berkurang
3. Ada bahan terbuang (waste):
   Debit: Beban Waste bertambah | Kredit: Persediaan berkurang
4. Barang dari supplier diterima:
   Debit: Persediaan bertambah | Kredit: Utang Usaha bertambah
5. Bayar supplier:
   Debit: Utang Usaha berkurang | Kredit: Kas berkurang
6. Bayar gaji:
   Debit: Beban Gaji bertambah | Kredit: Kas berkurang
7. DP reservasi masuk:
   Debit: Bank bertambah | Kredit: Uang Muka Customer (LIABILITY, bukan pendapatan!)

PERHATIKAN baris 7: DP belum jadi pendapatan karena pelanggan belum datang.
Baru saat check-in dan transaksi selesai, DP dipindahkan ke Pendapatan.

PRINSIP (kotak bawah):
- Double-entry: total debit SELALU = total kredit (divalidasi otomatis, kalau tidak seimbang jurnal DITOLAK)
- Immutable: sekali posting tidak bisa edit, koreksi pakai reversal journal
- Period closing: bulan yang sudah ditutup tidak bisa menerima transaksi baru
- Audit trail: siapa, kapan, dari event apa jurnal dibuat""")

# ══════════════════════════════════════════════════════════════
# SLIDE 18 — CLOSING / QUESTIONS
# ══════════════════════════════════════════════════════════════
s = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(s, BLACK)
add_rect(s, 0, Inches(2.4), W, Inches(0.06), RED)

add_text(s, Inches(1), Inches(0.7), Inches(11), Inches(0.8),
         "Questions & Discussion", size=42, color=WHITE, bold=True, align=PP_ALIGN.CENTER)

add_text(s, Inches(1), Inches(1.5), Inches(11), Inches(0.5),
         "Keputusan yang dibutuhkan:", size=20, color=RED, bold=True, align=PP_ALIGN.CENTER)

decisions = [
    "1.  Approve timeline 6 bulan (dari 12 bulan blueprint)?",
    "2.  Komposisi tim: hire/contract Frontend (Next.js) & DevOps?",
    "3.  Engage akuntan eksternal untuk validasi COA (PSAK)?",
    "4.  Ajukan Midtrans business account (production keys)?",
    "5.  Infrastructure provider: AWS (EKS) vs GCP (GKE) vs self-hosted?",
    "6.  Budget observability stack: Grafana Cloud vs self-hosted?",
]
lines = [(d, CREAM, False) for d in decisions]
add_multiline(s, Inches(2.5), Inches(2.7), Inches(8.5), Inches(3.0),
              lines, size=17, color=CREAM, line_spacing=1.6)

add_text(s, Inches(1), Inches(6.0), Inches(11), Inches(0.5),
         "ODGJ STREET COFFEE \u2014 Blueprint v2.0 Gap Analysis",
         size=16, color=GRAY, align=PP_ALIGN.CENTER)
add_text(s, Inches(1), Inches(6.5), Inches(11), Inches(0.5),
         "07 Oktober 2026", size=13, color=GRAY, align=PP_ALIGN.CENTER)

add_notes(s, """SLIDE 18 - CLOSING & DISCUSSION

Tutup presentasi dengan ajakan diskusi. 6 keputusan yang dibutuhkan:

1. APPROVE TIMELINE 6 BULAN - Apakah stakeholder setuju target 6 bulan
   (dari blueprint asli 12 bulan) dengan asumsi 4-5 engineer?

2. KOMPOSISI TIM - Perlu hire/contract frontend engineer (Next.js) dan DevOps engineer?
   Atau existing team bisa cover?

3. AKUNTAN EKSTERNAL - Untuk validasi Chart of Accounts sesuai standar PSAK
   SEBELUM mulai coding modul akuntansi.

4. MIDTRANS BUSINESS ACCOUNT - Ajukan sekarang karena proses verifikasi butuh waktu.
   Butuh: NIB, KTP penanggung jawab, rekening bank.

5. INFRASTRUCTURE PROVIDER - AWS (EKS) vs GCP (GKE) vs self-hosted?
   Pertimbangan: budget, lokasi data center, keahlian tim.

6. BUDGET OBSERVABILITY - Grafana Cloud (managed, bayar bulanan) vs
   self-hosted (gratis tapi butuh DevOps manage sendiri)?

Ringkasan 1 kalimat:
"Project sudah punya fondasi backend yang solid (~18 persen),
tinggal menutup gap customer PWA, inventori, akuntansi, dan infrastructure
dengan roadmap 6 fase selama 23 minggu."

Terima kasih - buka sesi tanya jawab.""")

# ══════════════════════════════════════════════════════════════
# SAVE
# ══════════════════════════════════════════════════════════════
output_path = r"C:\Users\RAYHAN M IKHBAL\odgj-street-coffee\PPT Persentasi Project Web ODGJ Street Reyhan.pptx"
prs.save(output_path)
print(f"SAVED: {output_path}")
print(f"Total slides: {len(prs.slides)}")
