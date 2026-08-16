"""Generate synthetic, non-sensitive PDF statement fixtures.

All content is fictional. No real bank, account, or person data is used.
Fixtures are deterministic and committed so parser tests do not require the
fixture tooling at test time.

Run with the parser virtual environment (fixture dependencies only):

    apps/parser/.venv/Scripts/python.exe fixtures/statements/pdf/generate_fixtures.py
"""

from __future__ import annotations

import io
from base64 import b64decode
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parent
ARIAL_PATH = "C:/Windows/Fonts/arial.ttf"
ARIAL_BD_PATH = "C:/Windows/Fonts/arialbd.ttf"
ARABIC_FONT_PATH = "C:/Windows/Fonts/trado.ttf"
try:
    pdfmetrics.registerFont(TTFont("ArialFixture", ARIAL_PATH))
    pdfmetrics.registerFont(TTFont("ArialBoldFixture", ARIAL_BD_PATH))
    pdfmetrics.registerFont(TTFont("ArabicFixture", ARABIC_FONT_PATH))
except Exception as error:  # pragma: no cover - environment dependent
    raise SystemExit(f"Required system font missing: {error}") from error

PIXEL_PNG = b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

TITLE_STYLE = ParagraphStyle("title", fontName="ArialBoldFixture", fontSize=16, leading=19, alignment=TA_CENTER)
META_STYLE = ParagraphStyle("meta", fontName="ArialFixture", fontSize=9, leading=12)
ARABIC_META_STYLE = ParagraphStyle("meta-ar", fontName="ArabicFixture", fontSize=11, leading=14)


def arabic(text: str) -> str:
    return get_display(arabic_reshaper.reshape(text))


def money(value: Decimal, decimals: int = 2, thousands: bool = False) -> str:
    quantized = value.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    raw = f"{quantized:.{decimals}f}"
    if thousands:
        sign = "-" if raw.startswith("-") else ""
        whole, _, fraction = raw.lstrip("-").partition(".")
        groups = []
        while whole:
            groups.append(whole[-3:])
            whole = whole[:-3]
        return f"{sign}{','.join(reversed(groups))}.{fraction}"
    return raw


def build_statement(
    filename: str,
    *,
    title: str,
    meta_lines: list[str],
    headers: list[str],
    rows: list[list[str]],
    footer_lines: list[str],
    font: str = "ArialFixture",
    header_font: str = "ArialBoldFixture",
    grid: bool = True,
    page_width: float = A4[0],
    page_height: float = A4[1],
    show_page_numbers: bool = True,
) -> Path:
    doc = SimpleDocTemplate(
        str(OUT / filename),
        pagesize=(page_width, page_height),
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title="Synthetic statement fixture",
        author="Racio",
    )
    style = ParagraphStyle("cell", fontName=font, fontSize=9, leading=11)
    header_style = ParagraphStyle("header", fontName=header_font, fontSize=9, leading=11)
    story: list[object] = [Paragraph(title, TITLE_STYLE), Spacer(1, 6)]
    for meta in meta_lines:
        story.append(Paragraph(meta, META_STYLE))
    story.append(Spacer(1, 8))
    table_data: list[list[object]] = [
        [Paragraph(header, header_style) for header in headers]
    ]
    table_data.extend([[Paragraph(cell, style) for cell in row] for row in rows])
    table = Table(table_data, repeatRows=1)
    style_commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    if grid:
        style_commands.extend(
            [
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.black),
                ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.grey),
            ]
        )
    table.setStyle(TableStyle(style_commands))
    story.append(table)
    story.append(Spacer(1, 8))
    for footer in footer_lines:
        story.append(Paragraph(footer, META_STYLE))
    story.append(Spacer(1, 4))

    def on_page(canvas_obj: canvas.Canvas, doc_obj: SimpleDocTemplate) -> None:
        if show_page_numbers:
            canvas_obj.setFont("ArialFixture", 8)
            canvas_obj.drawRightString(page_width - 0.6 * inch, 0.35 * inch, f"Page {doc_obj.page}")
        canvas_obj.setFont("ArialFixture", 8)
        canvas_obj.drawCentredString(page_width / 2, 0.35 * inch, "Confidential synthetic statement")

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return OUT / filename


def build_coordinate_layout(filename: str) -> Path:
    path = OUT / filename
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setFont("ArialFixture", 9)
    c.drawString(60, 800, "Riverside Co-op Bank")
    c.drawString(60, 786, "Statement Period: 01/08/2026 - 31/08/2026")
    c.drawString(60, 772, "Currency: GBP")
    c.drawString(60, 758, "Opening Balance  1000.00")
    c.drawString(60, 720, "Date")
    c.drawString(180, 720, "Description")
    c.drawRightString(430 + 80, 720, "Amount")
    c.drawRightString(520 + 80, 720, "Balance")
    rows = [
        ("01/08/2026", "PHARMACY PURCHASE", "-24.60", "975.40"),
        ("02/08/2026", "SALARY DEPOSIT", "+2300.00", "3275.40"),
        ("03/08/2026", "RESTAURANT PAYMENT", "-58.90", "3216.50"),
    ]
    y = 706
    for date, description, amount, balance in rows:
        c.drawString(60, y, date)
        c.drawString(180, y, description)
        c.drawRightString(430 + 80, y, amount)
        c.drawRightString(520 + 80, y, balance)
        y -= 16
    c.drawString(60, y - 8, "Closing Balance  3216.50")
    c.save()
    return path


def build_image_statement(filename: str, *, only_image: bool) -> Path:
    path = OUT / filename
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
    )
    story: list[object] = []
    if only_image:
        image = Image(io.BytesIO(PIXEL_PNG), width=7.0 * inch, height=9.0 * inch)
        story.append(image)
    else:
        story.append(Paragraph("Orchard Bank", TITLE_STYLE))
        image = Image(io.BytesIO(PIXEL_PNG), width=1.5 * inch, height=0.8 * inch)
        story.append(image)
        story.append(Spacer(1, 8))
        story.append(Paragraph("Date | Description | Amount", META_STYLE))
        story.append(Paragraph("01/08/2026 | MARKET PURCHASE | -12.00", META_STYLE))
        story.append(Paragraph("02/08/2026 | REFUND RECEIVED | +40.00", META_STYLE))
    doc.build(story)
    return path


def english_rows() -> list[list[str]]:
    opening = Decimal("1000.00")
    entries = [
        (1, "MARKETPLACE PAYMENT", Decimal("-145.50")),
        (2, "SALARY PAYROLL", Decimal("2500.00")),
        (3, "GROCERY STORE", Decimal("32.75")),
        (4, "UTILITY BILL", Decimal("-89.99")),
        (5, "MARKETPLACE PAYMENT", Decimal("-145.50")),
        (6, "ONLINE SHOPPING", Decimal("-240.00")),
        (7, "REFUND FROM TRAVEL AGENCY", Decimal("1250.00")),
        (8, "SUBSCRIPTION SERVICE", Decimal("-15.99")),
    ]
    rows: list[list[str]] = []
    balance = opening
    for day, description, amount in entries:
        balance += amount
        rows.append(
            [
                f"{day:02d}/08/2026",
                description,
                money(amount, thousands=True),
                money(balance, thousands=True),
            ]
        )
    return rows


def english_statement() -> Path:
    rows = english_rows()
    debit_total = sum(
        (Decimal(row[2].replace(",", "")) for row in rows if Decimal(row[2].replace(",", "")) < 0),
        start=Decimal("0.00"),
    )
    credit_total = sum(
        (Decimal(row[2].replace(",", "")) for row in rows if Decimal(row[2].replace(",", "")) > 0),
        start=Decimal("0.00"),
    )
    closing = Decimal(rows[-1][3].replace(",", ""))
    return build_statement(
        "english-statement.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=[
            "Statement Period: 01/08/2026 - 31/08/2026",
            "Account: ••••1234",
            "Currency: USD",
            "Opening Balance  1000.00",
        ],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=rows,
        footer_lines=[
            f"Closing Balance  {money(closing, thousands=True)}",
            f"Total Debits  {money(abs(debit_total), thousands=True)}",
            f"Total Credits  {money(credit_total, thousands=True)}",
        ],
    )


def multi_page_statement() -> Path:
    opening = Decimal("5000.00")
    rows: list[list[str]] = []
    balance = opening
    for index in range(1, 45):
        amount = Decimal("-37.50") if index % 2 else Decimal("150.00")
        balance += amount
        rows.append(
            [
                f"{index:02d}/08/2026",
                f"MONTHLY ACTIVITY ITEM {index:03d}",
                money(amount),
                money(balance),
            ]
        )
    return build_statement(
        "multi-page.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD", "Opening Balance  5000.00"],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=rows,
        footer_lines=["Closing Balance  " + money(balance)],
    )


def repeated_header_statement() -> Path:
    return build_statement(
        "repeated-header.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD", "Opening Balance  100.00"],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "-12.50", "87.50"],
            ["02/08/2026", "REFUND RECEIVED", "+40.00", "127.50"],
            ["03/08/2026", "UTILITY BILL", "-22.25", "105.25"],
        ],
        footer_lines=["Closing Balance  105.25"],
    )


def multiline_statement() -> Path:
    return build_statement(
        "multiline-descriptions.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD", "Opening Balance  100.00"],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT\nORDER 824731\nISTANBUL", "-145.50", "854.50"],
            ["02/08/2026", "ONLINE SHOPPING\nINVOICE #90123", "-240.00", "614.50"],
            ["03/08/2026", "SALARY PAYROLL", "+2500.00", "3114.50"],
        ],
        footer_lines=["Closing Balance  3114.50"],
    )


def debit_credit_statement() -> Path:
    return build_statement(
        "debit-credit-columns.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD", "Opening Balance  1000.00"],
        headers=["Date", "Description", "Debit", "Credit", "Balance"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "145.50", "", "854.50"],
            ["02/08/2026", "SALARY PAYROLL", "", "2500.00", "3354.50"],
            ["03/08/2026", "UTILITY BILL", "89.99", "", "3264.51"],
        ],
        footer_lines=["Closing Balance  3264.51"],
    )


def signed_amount_statement() -> Path:
    return build_statement(
        "signed-amount.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD", "Opening Balance  100.00"],
        headers=["Date", "Description", "Amount"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "-45.50"],
            ["02/08/2026", "REFUND RECEIVED", "+120.00"],
        ],
        footer_lines=["Closing Balance  174.50"],
    )


def balance_column_statement() -> Path:
    return build_statement(
        "balance-column.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD", "Opening Balance  1000.00"],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "-145.50", "854.50"],
            ["02/08/2026", "SALARY PAYROLL", "+2500.00", "3354.50"],
        ],
        footer_lines=["Closing Balance  3354.50"],
    )


def footer_totals_statement() -> Path:
    return build_statement(
        "footer-totals.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD", "Opening Balance  1000.00"],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "-145.50", "854.50"],
            ["02/08/2026", "SALARY PAYROLL", "+2500.00", "3354.50"],
            ["03/08/2026", "GROCERY STORE", "+32.75", "3387.25"],
        ],
        footer_lines=[
            "Closing Balance  3387.25",
            "Total Debits  145.50",
            "Total Credits  2532.75",
        ],
    )


def statement_metadata_statement() -> Path:
    return build_statement(
        "statement-metadata.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=[
            "Statement Period: 01/08/2026 - 31/08/2026",
            "Account: ••••1234",
            "Currency: USD",
            "Opening Balance  1000.00",
        ],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "-145.50", "854.50"],
            ["02/08/2026", "SALARY PAYROLL", "+2500.00", "3354.50"],
        ],
        footer_lines=["Closing Balance  3354.50"],
    )


def ambiguous_date_statement() -> Path:
    return build_statement(
        "ambiguous-date.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD"],
        headers=["Date", "Description", "Amount"],
        rows=[
            ["12/08", "MARKETPLACE PAYMENT", "-45.50"],
            ["13/08", "SALARY PAYROLL", "+2500.00"],
        ],
        footer_lines=[],
    )


def malformed_amount_statement() -> Path:
    return build_statement(
        "malformed-amount.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD"],
        headers=["Date", "Description", "Amount"],
        rows=[
            ["01/08/2026", "BROKEN VALUE", "12.34.56"],
            ["02/08/2026", "SAFE VALUE", "-10.00"],
        ],
        footer_lines=[],
    )


def duplicate_rows_statement() -> Path:
    return build_statement(
        "duplicate-rows.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD"],
        headers=["Date", "Description", "Amount"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "-45.50"],
            ["01/08/2026", "MARKETPLACE PAYMENT", "-45.50"],
            ["02/08/2026", "SALARY PAYROLL", "+2500.00"],
        ],
        footer_lines=[],
    )


def yearless_date_statement() -> Path:
    return build_statement(
        "yearless-date.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Statement Period: 01/08/2026 - 31/08/2026", "Currency: USD"],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=[
            ["01/08", "MARKETPLACE PAYMENT", "-45.50", "954.50"],
            ["02/08", "SALARY PAYROLL", "+2500.00", "3454.50"],
        ],
        footer_lines=["Closing Balance  3454.50"],
    )


def direction_marker_statement() -> Path:
    return build_statement(
        "direction-marker.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD"],
        headers=["Date", "Description", "Amount", "Type"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "45.50", "DR"],
            ["02/08/2026", "SALARY PAYROLL", "2500.00", "CR"],
        ],
        footer_lines=[],
    )


def arabic_statement() -> Path:
    return build_statement(
        "arabic-statement.pdf",
        title=arabic("مصرف النور الأهلي"),
        meta_lines=[
            arabic("الفترة: 01/08/2026 - 31/08/2026"),
            arabic("الحساب: ••••5678"),
            arabic("العملة: SAR"),
            arabic("الرصيد الافتتاحي  1000.00"),
        ],
        headers=[arabic("الرصيد"), arabic("دائن"), arabic("مدين"), arabic("البيان"), arabic("التاريخ")],
        rows=[
            [arabic("854.50"), arabic(""), arabic("145.50"), arabic("دفعة سوق إلكتروني"), arabic("01/08/2026")],
            [arabic("3354.50"), arabic("2500.00"), arabic(""), arabic("راتب شهري"), arabic("02/08/2026")],
            [arabic("3264.51"), arabic(""), arabic("89.99"), arabic("فاتورة كهرباء"), arabic("03/08/2026")],
        ],
        footer_lines=[arabic("الرصيد الختامي  3264.51")],
        font="ArabicFixture",
        header_font="ArabicFixture",
    )


def turkish_statement() -> Path:
    return build_statement(
        "turkish-statement.pdf",
        title="Anadolu Bankası",
        meta_lines=[
            "Dönem: 01/08/2026 - 31/08/2026",
            "Hesap: ••••2468",
            "Para Birimi: TRY",
            "Açılış Bakiyesi  1000,00",
        ],
        headers=["Tarih", "Açıklama", "Tutar", "Bakiye"],
        rows=[
            ["01/08/2026", "MARKET ALIŞVERİŞİ", "-145,50", "854,50"],
            ["02/08/2026", "MAAŞ ÖDEMESİ", "+2.500,00", "3.354,50"],
            ["03/08/2026", "FATURA ÖDEMESİ", "-89,99", "3.264,51"],
        ],
        footer_lines=["Kapanış Bakiyesi  3.264,51"],
    )


def text_with_images_statement() -> Path:
    return build_image_statement("text-with-images.pdf", only_image=False)


def image_only_statement() -> Path:
    return build_image_statement("image-only.pdf", only_image=True)


def table_no_borders_statement() -> Path:
    return build_statement(
        "table-no-borders.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD"],
        headers=["Date", "Description", "Amount"],
        rows=[
            ["01/08/2026", "MARKETPLACE PAYMENT", "-45.50"],
            ["02/08/2026", "SALARY PAYROLL", "+2500.00"],
        ],
        footer_lines=[],
        grid=False,
    )


def excessive_pages_statement() -> Path:
    opening = Decimal("100.00")
    rows: list[list[str]] = []
    balance = opening
    for index in range(1, 260):
        balance += Decimal("-1.00")
        rows.append(
            [f"{(index % 28) + 1:02d}/08/2026", f"ACTIVITY LINE {index:03d}", "-1.00", money(balance)]
        )
    return build_statement(
        "excessive-pages.pdf",
        title="Northwind Neighbourhood Bank",
        meta_lines=["Currency: USD"],
        headers=["Date", "Description", "Amount", "Balance"],
        rows=rows,
        footer_lines=[],
    )


def excessive_text_statement() -> Path:
    path = OUT / "excessive-text.pdf"
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setFont("ArialFixture", 9)
    huge = " ".join([f"WORD{index:05d}" for index in range(60_000)])
    c.drawString(60, 800, "Northwind Neighbourhood Bank")
    c.drawString(60, 786, "Date: 01/08/2026")
    c.drawString(60, 772, "Description: " + huge)
    c.drawString(60, 758, "Amount: -45.50")
    c.save()
    return path


def encrypted_statement() -> Path:
    source = OUT / "english-statement.pdf"
    target = OUT / "encrypted.pdf"
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(source))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt("racio-fixture-password")
    with open(target, "wb") as handle:
        writer.write(handle)
    return target


def embedded_file_statement() -> Path:
    source = OUT / "english-statement.pdf"
    target = OUT / "embedded-file.pdf"
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(source))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.add_attachment("note.txt", b"synthetic attachment payload")
    with open(target, "wb") as handle:
        writer.write(handle)
    return target


def malformed_statement() -> Path:
    target = OUT / "malformed.pdf"
    target.write_bytes(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n")
    return target


def fake_binary_statement() -> Path:
    target = OUT / "fake-binary.pdf"
    target.write_bytes(b"PK\x03\x04 not a pdf at all" + b"\x00" * 64)
    return target


def main() -> None:
    builders = [
        english_statement,
        multi_page_statement,
        repeated_header_statement,
        multiline_statement,
        debit_credit_statement,
        signed_amount_statement,
        balance_column_statement,
        footer_totals_statement,
        statement_metadata_statement,
        ambiguous_date_statement,
        malformed_amount_statement,
        duplicate_rows_statement,
        yearless_date_statement,
        direction_marker_statement,
        arabic_statement,
        turkish_statement,
        text_with_images_statement,
        image_only_statement,
        table_no_borders_statement,
        lambda: build_coordinate_layout("coordinate-layout.pdf"),
        excessive_pages_statement,
        excessive_text_statement,
        encrypted_statement,
        embedded_file_statement,
        malformed_statement,
        fake_binary_statement,
    ]
    for builder in builders:
        path = builder()
        print(f"wrote {path.name} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()