#!/usr/bin/env python3
"""Generate the platform-specific Traditional Chinese beginner manuals."""

from __future__ import annotations

import html
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output" / "pdf"
VERSION = "0.1.1"
DEFAULT_COLUMN_LAYOUT = "A / B / C"
PROGRAM_WRITTEN_VALUE = "由程式寫入"
MACOS_RUN_SCRIPT = "2_開始抓取.command"
WINDOWS_RUN_SCRIPT = "2_開始抓取.cmd"
WINDOWS_SCHEDULE_LAUNCHER = "3_安裝每天早上9點自動抓取.cmd"
WINDOWS_SCHEDULE_SCRIPT = "install-windows-task.ps1"
WINDOWS_SCHEDULE_LOG = "last-scheduled-run.log"

NAVY = colors.HexColor("#102A43")
BLUE = colors.HexColor("#1570EF")
BLUE_DARK = colors.HexColor("#175CD3")
BLUE_PALE = colors.HexColor("#EFF8FF")
GREEN = colors.HexColor("#039855")
GREEN_PALE = colors.HexColor("#ECFDF3")
AMBER = colors.HexColor("#DC6803")
AMBER_PALE = colors.HexColor("#FFFAEB")
RED = colors.HexColor("#D92D20")
RED_PALE = colors.HexColor("#FEF3F2")
GRAY_900 = colors.HexColor("#101828")
GRAY_700 = colors.HexColor("#344054")
GRAY_500 = colors.HexColor("#667085")
GRAY_300 = colors.HexColor("#D0D5DD")
GRAY_100 = colors.HexColor("#F2F4F7")
WHITE = colors.white


def register_fonts() -> tuple[str, str]:
    candidates = [
        (
            Path("/System/Library/Fonts/STHeiti Light.ttc"),
            Path("/System/Library/Fonts/STHeiti Medium.ttc"),
        ),
        (
            Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
            Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
        ),
    ]
    for regular, bold in candidates:
        if regular.is_file() and bold.is_file():
            pdfmetrics.registerFont(
                TTFont("ManualTC", str(regular), subfontIndex=0)
            )
            pdfmetrics.registerFont(
                TTFont("ManualTCBold", str(bold), subfontIndex=0)
            )
            return "ManualTC", "ManualTCBold"

    # Portable fallback for environments without the macOS system fonts.
    pdfmetrics.registerFont(UnicodeCIDFont("MSung-Light"))
    return "MSung-Light", "MSung-Light"


FONT, FONT_BOLD = register_fonts()


def build_styles():
    styles = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=styles["Title"],
            fontName=FONT_BOLD,
            fontSize=30,
            leading=39,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=8 * mm,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=styles["BodyText"],
            fontName=FONT,
            fontSize=14,
            leading=22,
            textColor=colors.HexColor("#D1E9FF"),
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=styles["Heading1"],
            fontName=FONT_BOLD,
            fontSize=23,
            leading=30,
            textColor=NAVY,
            spaceAfter=4 * mm,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=styles["Heading2"],
            fontName=FONT_BOLD,
            fontSize=15,
            leading=21,
            textColor=BLUE_DARK,
            spaceBefore=3 * mm,
            spaceAfter=2 * mm,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=styles["BodyText"],
            fontName=FONT,
            fontSize=10.4,
            leading=17,
            textColor=GRAY_700,
            wordWrap="CJK",
            spaceAfter=2.2 * mm,
        ),
        "body_bold": ParagraphStyle(
            "BodyBold",
            parent=styles["BodyText"],
            fontName=FONT_BOLD,
            fontSize=10.4,
            leading=17,
            textColor=GRAY_900,
            wordWrap="CJK",
            spaceAfter=2.2 * mm,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=styles["BodyText"],
            fontName=FONT,
            fontSize=8.3,
            leading=13,
            textColor=GRAY_500,
            wordWrap="CJK",
        ),
        "step_number": ParagraphStyle(
            "StepNumber",
            parent=styles["BodyText"],
            fontName=FONT_BOLD,
            fontSize=13,
            leading=18,
            alignment=TA_CENTER,
            textColor=WHITE,
        ),
        "step_title": ParagraphStyle(
            "StepTitle",
            parent=styles["BodyText"],
            fontName=FONT_BOLD,
            fontSize=11.2,
            leading=16,
            textColor=GRAY_900,
        ),
        "step_body": ParagraphStyle(
            "StepBody",
            parent=styles["BodyText"],
            fontName=FONT,
            fontSize=9.4,
            leading=14.5,
            textColor=GRAY_700,
            wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "Code",
            parent=styles["Code"],
            fontName=FONT,
            fontSize=8.2,
            leading=12.5,
            textColor=colors.HexColor("#D1E9FF"),
            wordWrap="CJK",
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=styles["BodyText"],
            fontName=FONT_BOLD,
            fontSize=8.6,
            leading=12,
            textColor=WHITE,
            alignment=TA_CENTER,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=styles["BodyText"],
            fontName=FONT,
            fontSize=8.4,
            leading=12.5,
            textColor=GRAY_700,
            wordWrap="CJK",
        ),
        "table_cell_bold": ParagraphStyle(
            "TableCellBold",
            parent=styles["BodyText"],
            fontName=FONT_BOLD,
            fontSize=8.4,
            leading=12.5,
            textColor=GRAY_900,
            wordWrap="CJK",
        ),
        "link": ParagraphStyle(
            "Link",
            parent=styles["BodyText"],
            fontName=FONT,
            fontSize=8.4,
            leading=13,
            textColor=BLUE_DARK,
            wordWrap="CJK",
        ),
    }


STYLES = build_styles()


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, STYLES[style])


def heading(number: str, title: str, intro: str | None = None):
    items = [p(f"{number}　{title}", "h1"), HRFlowable(width="100%", thickness=1, color=GRAY_300)]
    if intro:
        items.extend([Spacer(1, 3 * mm), p(intro)])
    return items


def step(number: int, title: str, body: str, color=BLUE) -> Table:
    data = [
        [p(str(number), "step_number"), p(title, "step_title")],
        ["", p(body, "step_body")],
    ]
    table = Table(data, colWidths=[13 * mm, 152 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), color),
                ("BOX", (0, 0), (0, 0), 0, color),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (0, -1), 3 * mm),
                ("RIGHTPADDING", (0, 0), (0, -1), 3 * mm),
                ("TOPPADDING", (0, 0), (0, 0), 2.2 * mm),
                ("BOTTOMPADDING", (0, 0), (0, 0), 2.2 * mm),
                ("LEFTPADDING", (1, 0), (1, -1), 4 * mm),
                ("RIGHTPADDING", (1, 0), (1, -1), 2 * mm),
                ("TOPPADDING", (1, 0), (1, 0), 0.8 * mm),
                ("BOTTOMPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (1, 1), (1, 1), 0.5 * mm),
                ("BOTTOMPADDING", (1, 1), (1, 1), 2.5 * mm),
            ]
        )
    )
    return table


def callout(title: str, body: str, kind: str = "info") -> Table:
    palette = {
        "info": (BLUE_DARK, BLUE_PALE),
        "success": (GREEN, GREEN_PALE),
        "warning": (AMBER, AMBER_PALE),
        "danger": (RED, RED_PALE),
    }
    accent, background = palette[kind]
    title_style = ParagraphStyle(
        f"CalloutTitle-{kind}",
        parent=STYLES["body_bold"],
        textColor=accent,
        spaceAfter=1 * mm,
    )
    body_style = ParagraphStyle(
        f"CalloutBody-{kind}",
        parent=STYLES["body"],
        fontSize=9.4,
        leading=15,
        spaceAfter=0,
    )
    table = Table(
        [[Paragraph(title, title_style)], [Paragraph(body, body_style)]],
        colWidths=[165 * mm],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), background),
                ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
                ("TOPPADDING", (0, 0), (0, 0), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (0, 0), 0),
                ("TOPPADDING", (0, 1), (0, 1), 0),
                ("BOTTOMPADDING", (0, 1), (0, 1), 3 * mm),
            ]
        )
    )
    return table


def code_block(text: str) -> Table:
    escaped = html.escape(text).replace("\n", "<br/>")
    table = Table([[Paragraph(escaped, STYLES["code"])]], colWidths=[165 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), NAVY),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#1D4ED8")),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ]
        )
    )
    return table


def data_table(headers: list[str], rows: list[list[str]], widths: list[float]) -> Table:
    data = [[p(item, "table_header") for item in headers]]
    for row in rows:
        data.append(
            [
                p(item, "table_cell_bold" if column == 0 else "table_cell")
                for column, item in enumerate(row)
            ]
        )
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.5, GRAY_300),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
    ]
    for row_index in range(1, len(data)):
        if row_index % 2 == 0:
            style.append(("BACKGROUND", (0, row_index), (-1, row_index), GRAY_100))
    table.setStyle(TableStyle(style))
    return table


def cover_steps_table() -> Table:
    number_style = ParagraphStyle(
        "CoverStepNumber",
        parent=STYLES["table_header"],
        fontSize=10,
        textColor=WHITE,
    )
    label_style = ParagraphStyle(
        "CoverStepLabel",
        parent=STYLES["table_cell"],
        fontSize=8.4,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#D1E9FF"),
    )
    table = Table(
        [
            [Paragraph(str(number), number_style) for number in range(1, 5)],
            [
                Paragraph(label, label_style)
                for label in ["下載並解壓縮", "建立 Google 憑證", "填寫設定檔", "雙擊開始抓取"]
            ],
        ],
        colWidths=[41.25 * mm] * 4,
    )
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#84CAFF")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0B3558")),
                ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
            ]
        )
    )
    return table


def bullet(text: str) -> Paragraph:
    style = ParagraphStyle(
        "BulletLine",
        parent=STYLES["body"],
        leftIndent=6 * mm,
        firstLineIndent=-4 * mm,
        bulletIndent=0,
        spaceAfter=1.4 * mm,
    )
    return Paragraph(f"<bullet>•</bullet>{text}", style)


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, platform_label: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=22 * mm,
            rightMargin=22 * mm,
            topMargin=21 * mm,
            bottomMargin=19 * mm,
            title=f"GamerCatch 零基礎使用手冊 - {platform_label}",
            author="GamerCatch",
            subject="多遊戲、多 Google Sheets 帳號設定與操作",
        )
        self.platform_label = platform_label
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="content",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(
            [PageTemplate(id="manual", frames=[frame], onPage=self.draw_page)]
        )

    def draw_page(self, canvas, doc):
        if doc.page == 1:
            canvas.saveState()
            canvas.setFillColor(NAVY)
            canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
            canvas.setFillColor(BLUE)
            canvas.circle(A4[0] - 24 * mm, A4[1] - 30 * mm, 40 * mm, fill=1, stroke=0)
            canvas.setFillColor(colors.HexColor("#0B4A6F"))
            canvas.circle(18 * mm, 24 * mm, 34 * mm, fill=1, stroke=0)
            canvas.restoreState()
            return

        canvas.saveState()
        canvas.setStrokeColor(GRAY_300)
        canvas.setLineWidth(0.5)
        canvas.line(22 * mm, A4[1] - 14 * mm, A4[0] - 22 * mm, A4[1] - 14 * mm)
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(GRAY_500)
        canvas.drawString(22 * mm, A4[1] - 10.5 * mm, "GamerCatch 零基礎使用手冊")
        canvas.drawRightString(
            A4[0] - 22 * mm,
            A4[1] - 10.5 * mm,
            self.platform_label,
        )
        canvas.line(22 * mm, 13 * mm, A4[0] - 22 * mm, 13 * mm)
        canvas.drawString(22 * mm, 8.5 * mm, f"版本 {VERSION}")
        canvas.drawRightString(A4[0] - 22 * mm, 8.5 * mm, f"第 {doc.page} 頁")
        canvas.restoreState()


def cover(platform: str):
    return [
        Spacer(1, 34 * mm),
        p("GamerCatch", "cover_title"),
        p("零基礎設定與操作手冊", "cover_title"),
        Spacer(1, 4 * mm),
        p(f"{platform} 版｜多遊戲、多 Google Sheets 帳號", "cover_subtitle"),
        Spacer(1, 20 * mm),
        callout(
            "您不需要會寫程式",
            "本手冊只會請您操作兩個地方：<b>config.toml</b> 設定檔，以及 <b>credentials</b> 憑證資料夾。其他檔案請保持原位。",
            "info",
        ),
        Spacer(1, 14 * mm),
        cover_steps_table(),
        Spacer(1, 29 * mm),
        p(
            "用途：一次抓取多個巴哈手機遊戲的排行與人氣，並分別寫入不同人的 Google 試算表。",
            "cover_subtitle",
        ),
        Spacer(1, 4 * mm),
        p(f"文件版本 {VERSION}｜2026-07-21", "cover_subtitle"),
        PageBreak(),
    ]


def download_page(platform: str):
    items = heading("01", "下載正確版本並完整解壓縮", "最常見的失敗原因，就是直接在 ZIP 裡執行，或只把其中一個檔案拖出來。")
    launcher_types = ".command" if platform == "macOS" else ".cmd 或 .ps1"
    if platform == "macOS":
        items += [
            step(1, "確認晶片", "點左上角蘋果選單，再點「關於這台 Mac」。本版只支援 Apple M1、M2、M3、M4 等 Apple Silicon 晶片；Intel Mac 暫不支援。"),
            step(2, "下載 ZIP", "從本專案的 GitHub Release 下載 <b>GamerCatch-macOS-arm64.zip</b>。若您的 Mac 顯示 Intel，請不要下載本版。"),
            step(3, "完整解壓縮", "雙擊 ZIP，將整個解壓縮後的 GamerCatch 資料夾放到「文件」等容易找到的位置。"),
            step(4, "確認檔案", "資料夾內應看到 GamerCatch、兩個 .command、config.toml、credentials、playwright-driver 與本手冊。"),
        ]
    else:
        items += [
            step(1, "確認系統類型", "開啟「設定」→「系統」→「關於」。本版只支援一般 Intel 或 AMD 的 x64 電腦；Snapdragon、Windows on ARM 暫不支援。"),
            step(2, "下載 ZIP", "從本專案的 GitHub Release 下載 <b>GamerCatch-Windows-x64.zip</b>。若系統類型顯示 ARM，請不要下載本版。"),
            step(3, "全部解壓縮", "在 ZIP 上按右鍵，選「全部解壓縮」。請進入解壓縮完成的新資料夾後再操作。"),
            step(
                4,
                "確認檔案",
                f"資料夾內應看到 GamerCatch.exe、三個 .cmd、{WINDOWS_SCHEDULE_SCRIPT}、"
                "config.toml、credentials、playwright-driver 與本手冊。",
            ),
        ]
    items += [
        Spacer(1, 4 * mm),
        callout(
            "不要拆散資料夾",
            f"主程式、雙擊腳本與 playwright-driver 必須放在一起。不要只複製 {launcher_types} 或執行檔。",
            "danger",
        ),
        PageBreak(),
    ]
    return items


def safety_page(platform: str):
    items = heading("02", "第一次雙擊與系統安全提示")
    starter = "1_首次設定.command" if platform == "macOS" else "1_首次設定.cmd"
    items += [
        callout(
            "只從官方 Release 下載",
            "系統警告是提醒您確認來源。請先核對 GitHub repository 為 <b>Willseed/gamer-catch-rust</b>，再決定是否執行。不要關閉 Gatekeeper、防毒或 SmartScreen。",
            "warning",
        ),
        Spacer(1, 4 * mm),
        step(1, f"雙擊 {starter}", "第一次會準備 Chromium，可能需要數分鐘。請保持網路連線，也不要關閉黑色視窗。"),
    ]
    if platform == "macOS":
        items += [
            step(2, "若被阻擋，使用安全的開啟方式", "目前 macOS 預覽版尚未使用 Developer ID 簽章或 Apple 公證。按住 Control 點擊檔案，選「打開」；若仍被阻擋，前往「系統設定」→「隱私權與安全性」，核對來源後選「仍要打開」。"),
            step(3, "不要貼解除安全指令", "請勿執行網路文章提供的 xattr、spctl 或關閉 Gatekeeper 指令。這類做法會擴大整台電腦的風險。"),
            step(4, "等待三個項目開啟", "完成後會開啟 TextEdit 裡的 config.toml、Finder 裡的 credentials 資料夾，以及這份 PDF 手冊。"),
        ]
    else:
        items += [
            step(2, "若出現 SmartScreen", "目前 Windows 版尚未簽章，可能顯示「未知的發行者」。只有來源與檔案完全正確時，才考慮「其他資訊」→「仍要執行」。"),
            step(3, "不要關閉防毒", "若公司電腦不允許執行，請交給 IT 管理員確認。不要停用 Windows 安全性或公司端點保護。"),
            step(4, "等待三個項目開啟", "完成後會開啟記事本裡的 config.toml、檔案總管裡的 credentials 資料夾，以及這份 PDF 手冊。"),
        ]
    items += [PageBreak()]
    return items


def prep_page():
    return heading(
        "03",
        "開始前，先把資料寫在這張表",
        "每個遊戲都可以屬於不同的人、不同 Google 帳號、不同 Cloud 專案、不同 JSON 與不同試算表。完全不需要共用帳號。",
    ) + [
        data_table(
            ["編號", "遊戲名稱", "試算表擁有者", "分頁名稱", "JSON 檔名", "欄位"],
            [
                ["1", "夜鴉", "＿＿＿＿", "每日排名", "person-1-service-account.json", DEFAULT_COLUMN_LAYOUT],
                ["2", "＿＿＿＿", "＿＿＿＿", "每日排名", "person-2-service-account.json", DEFAULT_COLUMN_LAYOUT],
                ["3", "＿＿＿＿", "＿＿＿＿", "每日排名", "person-3-service-account.json", DEFAULT_COLUMN_LAYOUT],
            ],
            [12 * mm, 27 * mm, 29 * mm, 25 * mm, 48 * mm, 24 * mm],
        ),
        Spacer(1, 6 * mm),
        p("每一列要準備的五樣東西", "h2"),
        bullet("巴哈排行卡片上顯示的完整遊戲名稱。空格、全形符號與系列名稱都要一致。"),
        bullet("Google 試算表的完整網址。最簡單的方法就是從瀏覽器網址列全部複製。"),
        bullet("試算表底部的工作表分頁名稱，例如「每日排名」。這不是上方的檔案名稱。"),
        bullet("日期、排行、人氣分別在哪一欄，例如 A、B、C。"),
        bullet(
            "該遊戲自己使用的 service account JSON。三個遊戲可以用三份不同 JSON。"
            "現在看不懂沒關係，第 5 頁起會逐步說明。"
        ),
        Spacer(1, 5 * mm),
        callout(
            "先做一個遊戲也可以",
            "第二、第三個區塊可以先保持 enabled = false。第一個遊戲成功後，再逐一加入其他遊戲。",
            "success",
        ),
        PageBreak(),
    ]


def sheet_page():
    return heading("04", "準備每一張 Google 試算表") + [
        p("建議每張試算表先建立以下欄位與日期。程式只尋找已經存在的今天，不會自行新增日期列。"),
        data_table(
            ["A 欄", "B 欄", "C 欄"],
            [
                ["日期", "排行", "人氣"],
                ["2026/7/21", PROGRAM_WRITTEN_VALUE, PROGRAM_WRITTEN_VALUE],
                ["2026/7/22", PROGRAM_WRITTEN_VALUE, PROGRAM_WRITTEN_VALUE],
            ],
            [55 * mm, 55 * mm, 55 * mm],
        ),
        Spacer(1, 5 * mm),
        step(1, "輸入真正的日期", "在 A2 之後輸入 2026/7/21 這類日期。請不要在前面加單引號，也不要只輸入 7/21 這種沒有年份的純文字。"),
        step(2, "確認分頁名稱", "看試算表底部的分頁標籤，例如「每日排名」。之後 worksheet_name 要逐字相同。"),
        step(3, "保留今天那一列", "程式找到今天後，才會把排行與人氣寫到同一列。找不到今天時會清楚回報未完成。"),
        step(4, "執行時不要動資料列", "從讀取日期到寫入完成前，請勿排序、插入或刪除資料列。"),
        PageBreak(),
    ]


def google_cloud_page():
    return heading(
        "05",
        "啟用 Google Sheets API",
        "以下 Google Cloud 步驟，每位試算表使用者都要各做一次。三位使用者完成後，會有三份彼此獨立的 JSON。",
    ) + [
        step(1, "登入 Google Cloud Console", "使用該張試算表管理者自己的 Google 帳號登入 console.cloud.google.com。"),
        step(2, "建立或選擇專案", "從上方專案選單建立新專案，例如 GamerCatch-夜鴉。第二、第三位使用者可在自己的帳號建立各自專案。"),
        step(3, "進入 API 程式庫", "左上角選單 →「API 和服務」→「程式庫」。"),
        step(4, "啟用 Google Sheets API", "搜尋 Google Sheets API，點進結果後按「啟用」。請確認不是只建立 API key。"),
        Spacer(1, 4 * mm),
        callout(
            "不需要 OAuth 同意畫面",
            "本工具使用 service account 直接存取已分享的特定試算表，不使用個人 OAuth 登入，也不需要網域範圍委派。",
            "info",
        ),
        PageBreak(),
    ]


def service_account_page():
    return heading("06", "建立 service account 並下載 JSON") + [
        step(1, "開啟服務帳戶", "Google Cloud 左上角選單 →「IAM 與管理」→「服務帳戶」，再按「建立服務帳戶」。"),
        step(2, "取一個看得懂的名稱", "例如 gamercatch-nightcrow。名稱只用來讓您辨認，不會改變巴哈遊戲名稱。"),
        step(3, "不要亂給 Cloud 角色", "本工具不需要 Google Cloud 專案 Owner 或 Editor。若畫面允許，可以略過角色直接完成。試算表權限稍後在 Google Sheets 裡分享。"),
        step(4, "建立 JSON 金鑰", "點進新建立的 service account →「金鑰」→「新增金鑰」→「建立新的金鑰」→選 JSON →「建立」。瀏覽器會下載一份 .json。"),
        Spacer(1, 4 * mm),
        callout(
            "JSON 就是程式專用密碼",
            "金鑰建立後不能再次下載同一份私鑰。請勿上傳到 GitHub、公開雲端連結、群組聊天室或問題回報附件。若外洩，請立刻在 Google Cloud 刪除舊金鑰並建立新的。",
            "danger",
        ),
        Spacer(1, 4 * mm),
        callout(
            "公司或學校禁止建立金鑰？",
            "這通常是組織安全政策，不是程式故障。請聯絡該組織的 Google 管理員；不要嘗試繞過政策。",
            "warning",
        ),
        PageBreak(),
    ]


def sharing_page():
    return heading("07", "把試算表分享給正確的 service account") + [
        p("您本人能開啟試算表，不代表程式也有權限。service account 是另一個機器帳號，必須單獨分享。"),
        step(1, "找出 client_email", "用 TextEdit 或記事本開啟剛下載的 JSON，尋找 client_email。它通常是 gamercatch-名稱@專案ID.iam.gserviceaccount.com。"),
        step(2, "只複製電子郵件", "只複製 client_email 引號內的地址。不要把整份 JSON 貼到任何網站或聊天室。"),
        step(3, "開啟正確的 Google Sheet", "按右上角「共用」，貼上這個 client_email，權限選擇「編輯者」。service account 沒有收件匣，可取消寄送通知。"),
        step(4, "逐一核對配對", "第 1 張表分享給第 1 份 JSON 的 client_email；第 2 張表分享給第 2 份；第 3 張表分享給第 3 份。"),
        Spacer(1, 4 * mm),
        code_block('"client_email": "gamercatch-nightcrow@example-project.iam.gserviceaccount.com"'),
        Spacer(1, 4 * mm),
        callout(
            "只需要分享特定檔案",
            "不需要把整個 Google Drive 公開，也不需要把 service account 設成網域管理員。",
            "success",
        ),
        PageBreak(),
    ]


def credentials_page(platform: str):
    file_view_tip = (
        "Finder 會直接顯示 .json；請確認檔案不是放在 credentials 外面。"
        if platform == "macOS"
        else "建議在檔案總管選「檢視」→「顯示」→「副檔名」，避免實際檔名變成 .json.json。"
    )
    return heading("08", "把 JSON 放進 credentials 資料夾") + [
        step(1, "重新命名三份 JSON", "建議依序命名為 person-1-service-account.json、person-2-service-account.json、person-3-service-account.json。"),
        step(2, "拖進 credentials", "把 JSON 拖進第一次設定時開啟的 credentials 資料夾。不要放在 playwright-driver，也不要跟執行檔混在同一層。"),
        step(3, "確認副檔名", file_view_tip),
        Spacer(1, 4 * mm),
        code_block(
            "GamerCatch 資料夾/\n"
            "  config.toml\n"
            "  credentials/\n"
            "    person-1-service-account.json\n"
            "    person-2-service-account.json\n"
            "    person-3-service-account.json"
        ),
        Spacer(1, 5 * mm),
        callout(
            "不要把自己的設定重新壓回公開 ZIP",
            "正式下載包裡的 credentials 是空資料夾。您放入的 JSON 只應留在自己的電腦，不應跟著上傳或分享。",
            "danger",
        ),
        PageBreak(),
    ]


def config_rules_page():
    return heading("09", "編輯 config.toml 的三條規則") + [
        callout(
            "只修改等號右邊",
            "引號內的文字可以換；true / false 必須是小寫且不加引號；頁碼與列號用數字且不加引號。",
            "info",
        ),
        Spacer(1, 5 * mm),
        data_table(
            ["可以修改", "正確例子", "錯誤例子"],
            [
                ["引號內文字", 'game_name = "夜鴉"', "刪掉雙引號"],
                ["安全開關", "enabled = true", 'enabled = "true"'],
                ["數字", "end_page = 20", 'end_page = "20"'],
            ],
            [42 * mm, 63 * mm, 60 * mm],
        ),
        Spacer(1, 6 * mm),
        bullet("不要刪除 [[games]]、欄位名稱、等號、雙引號或方括號。"),
        bullet("編輯後直接按「儲存」，不要另存成 config.toml.txt。"),
        bullet("一般使用者不要修改 base_url、category、逾時或延遲。"),
        bullet("建議保留 headless = false，遇到巴哈安全驗證時才看得到瀏覽器。"),
        bullet("若遊戲超過第 20 頁，可提高 end_page，但最多 200；頁數越多，執行越久。"),
        Spacer(1, 5 * mm),
        callout(
            "改壞了怎麼辦？",
            "不要硬猜。打開旁邊的 config.example.toml 對照，或重新複製一份再填。請先備份原本可用的 config.toml。",
            "warning",
        ),
        PageBreak(),
    ]


def config_fields_page():
    rows = [
        ["enabled", "true 要抓；不用的區塊保持 false"],
        ["game_name", "巴哈排行卡片上的完整遊戲名稱"],
        ["write_to_google_sheets", "第一次保持 false；確認抓取正確後才改 true"],
        ["spreadsheet_id", "直接貼完整 Google 試算表網址最簡單"],
        ["service_account_key_path", "對應 JSON 的位置，例如 credentials/person-1-service-account.json"],
        ["worksheet_name", "試算表底部的分頁名稱，不是檔案名稱"],
        ["timezone", "台灣使用 Asia/Taipei"],
        ["first_data_row", "第 1 列是標題時填 2"],
        ["date_column", "日期欄，例如 A"],
        ["rank_column", "排行欄，例如 B"],
        ["popularity_column", "人氣欄，例如 C"],
    ]
    return heading("10", "每一個設定欄位是什麼") + [
        data_table(["欄位", "小白版說明"], rows, [57 * mm, 108 * mm]),
        Spacer(1, 5 * mm),
        callout(
            f"三個人都用 {DEFAULT_COLUMN_LAYOUT} 沒問題",
            "若三個遊戲寫入三張不同試算表，各自都用 A、B、C 完全正常。只有同一張試算表、同一個分頁時，輸出欄位才不能重疊。",
            "success",
        ),
        PageBreak(),
    ]


def config_examples_page():
    return heading("11", "三個遊戲怎麼填") + [
        p("先完成遊戲 1。遊戲 2、3 可以複製相同格式，但要換成各自的名稱、試算表網址與 JSON。"),
        code_block(
            "[[games]]\n"
            "enabled = true\n"
            'game_name = "夜鴉"\n'
            "write_to_google_sheets = false\n"
            'spreadsheet_id = "https://docs.google.com/spreadsheets/d/第一張ID/edit"\n'
            'service_account_key_path = "credentials/person-1-service-account.json"\n'
            'worksheet_name = "每日排名"\n'
            'timezone = "Asia/Taipei"\n'
            "first_data_row = 2\n"
            'date_column = "A"\n'
            'rank_column = "B"\n'
            'popularity_column = "C"'
        ),
        Spacer(1, 5 * mm),
        p("第二個遊戲的差異", "h2"),
        code_block(
            "[[games]]\n"
            "enabled = true\n"
            'game_name = "請填巴哈上的第二個完整名稱"\n'
            "write_to_google_sheets = false\n"
            'spreadsheet_id = "https://docs.google.com/spreadsheets/d/第二張ID/edit"\n'
            'service_account_key_path = "credentials/person-2-service-account.json"'
        ),
        Spacer(1, 5 * mm),
        p("第三個遊戲同理，改用第三張試算表與 person-3-service-account.json。若暫時不用，請保持 enabled = false。"),
        callout(
            "同一款遊戲也能寫給不同人",
            "可以建立兩個 game_name 都是夜鴉的區塊，分別填不同 spreadsheet_id 與不同 JSON。程式只抓一次，再各自寫入。",
            "info",
        ),
        PageBreak(),
    ]


def dry_run_page(platform: str):
    runner = MACOS_RUN_SCRIPT if platform == "macOS" else WINDOWS_RUN_SCRIPT
    return heading("12", "第一次先做安全測試") + [
        callout(
            "所有遊戲先保持 write_to_google_sheets = false",
            "這樣程式會抓取排行與人氣，但不會修改任何 Google 試算表。",
            "success",
        ),
        Spacer(1, 4 * mm),
        step(1, "儲存 config.toml", "確認要測試的遊戲 enabled = true，而且每一個 write_to_google_sheets 都是 false。"),
        step(2, f"雙擊 {runner}", "瀏覽器開啟後請等待。若出現巴哈安全驗證，請在畫面上自行完成；程式不會繞過 CAPTCHA。"),
        step(3, "核對每個結果", "成功訊息會顯示遊戲名稱、排行、人氣與 page。請確認數字與巴哈頁面相符。"),
        step(4, "看到未寫入才是正常", "測試階段會顯示 write_to_google_sheets=false，未寫入 Google Sheets。"),
        Spacer(1, 4 * mm),
        code_block(
            "抓取成功：夜鴉｜排行 123｜人氣 456｜page=5\n"
            "夜鴉：write_to_google_sheets=false，未寫入 Google Sheets。"
        ),
        Spacer(1, 4 * mm),
        callout(
            "客服用的強制 dry-run",
            "命令列的 --dry-run 會強制所有遊戲不寫入，即使設定檔有人誤填 true。一般使用者不需要使用；依客服指示操作即可。",
            "info",
        ),
        PageBreak(),
    ]


def production_page(platform: str):
    runner = MACOS_RUN_SCRIPT if platform == "macOS" else WINDOWS_RUN_SCRIPT
    log_note = (
        "遇到問題可查看同一資料夾的 last-run.log。"
        if platform == "macOS"
        else "程式會把 last-run.log 留在同一資料夾，方便回看錯誤。"
    )
    schedule_note = (
        f"若想每天自動執行，請先完成本頁，再看下一頁的 {WINDOWS_SCHEDULE_LAUNCHER}。"
        if platform == "Windows"
        else ""
    )
    return heading("13", "開啟正式寫入與平常執行") + [
        p("建議一次只開啟一個遊戲，確認試算表真的寫對，再開下一個。"),
        step(1, "先開遊戲 1", "把第 1 個遊戲改成 write_to_google_sheets = true，儲存。其他遊戲仍保持 false。"),
        step(2, f"雙擊 {runner}", "等待顯示「Google Sheets 更新完成」與列號。若今天日期不存在，會顯示未完成並保留視窗。"),
        step(3, "回 Google Sheets 核對", "確認今天那一列的排行與人氣正確，而且沒有寫到別人的試算表。"),
        step(4, "再開遊戲 2、3", "依序把其他已驗證的遊戲改成 true。任何一人的 JSON 或 Sheets 失敗，不會阻止其他人的遊戲繼續。"),
        Spacer(1, 4 * mm),
        callout(
            "平常只需要雙擊開始抓取",
            f"看到「全部處理完成」後即可關閉視窗。{log_note}{schedule_note}",
            "success",
        ),
        Spacer(1, 5 * mm),
        callout(
            "不要一天重複執行很多次",
            "程式會更新今天同一列，不會新增列；仍建議合理控制執行頻率，避免增加巴哈與 Google API 負擔。",
            "warning",
        ),
        PageBreak(),
    ]


def windows_schedule_page():
    return heading(
        "13-1",
        "Windows：每天 09:00 自動抓取",
        "這是選用功能。09:00 是 Windows 的本機時間；試算表要找哪一天，仍由每個遊戲的 timezone 決定。",
    ) + [
        callout(
            "先手動成功，再安裝排程",
            f"請先用 {WINDOWS_RUN_SCRIPT} 完成安全測試與正式寫入，確認所有遊戲、JSON、試算表和日期列都正確。安裝排程不會立刻抓取。",
            "warning",
        ),
        Spacer(1, 4 * mm),
        step(1, "先把資料夾放到固定位置", "建議放在文件等不會移動的位置。Task 會記住這個資料夾的完整路徑。"),
        step(2, f"雙擊 {WINDOWS_SCHEDULE_LAUNCHER}", "畫面不會要求系統管理員權限，也不會永久修改 PowerShell 執行原則。"),
        step(3, "確認安裝完成", "視窗會顯示 Task 名稱與下一次執行時間。重複雙擊會更新同一個 Task，不會一直增加副本。"),
        step(4, f"隔天查看 {WINDOWS_SCHEDULE_LOG}", "一個 Task 會處理 config.toml 內所有 enabled = true 的遊戲與各自的 JSON。若遇到 CAPTCHA，仍需手動處理。"),
        Spacer(1, 4 * mm),
        p("什麼情況會執行", "h2"),
        bullet("Task 使用目前登入的 Windows 帳號與標準權限，不需要密碼或系統管理員。鎖定畫面仍可執行，但登出後不會執行。"),
        bullet("睡眠時會在硬體與電源設定允許時嘗試喚醒；完全關機不能喚醒。錯過 09:00 時，會在之後登入且電腦與網路可用時補跑。"),
        bullet("排程仍遵守 headless 設定。false 會在 09:00 開啟 Chromium；改成 true 可在背景執行，但遇到巴哈安全驗證時仍要改回 false 手動處理。"),
        bullet("要停用或刪除時，搜尋並開啟「工作排程器」，在「工作排程器程式庫」找到 GamerCatch-Daily-0900 開頭的項目。"),
        Spacer(1, 4 * mm),
        callout(
            "搬動資料夾或更新版本後要重裝",
            f"移動、改名或換到新版資料夾後，請在新位置重新雙擊 {WINDOWS_SCHEDULE_LAUNCHER}，讓 Task 更新成新路徑。",
            "info",
        ),
        PageBreak(),
    ]


def change_game_page(platform: str):
    rows = [
        ["game_name", "改成巴哈排行卡片上的完整新名稱，空格與符號都要一致。"],
        ["end_page", "新遊戲若不在目前掃描範圍，提高 [bahamut] 的 end_page；這會套用到所有遊戲。"],
        ["試算表與分頁", "換表時修改 spreadsheet_id 與 worksheet_name。"],
        ["JSON", "換擁有者或帳號時修改 service_account_key_path，並把新表分享給該 JSON 的 client_email。"],
        ["日期列與欄位", "核對 first_data_row、date_column、rank_column、popularity_column，並先建立今天日期。"],
        ["啟用狀態", "新遊戲設 enabled = true；不用的舊遊戲設 false，避免兩個區塊同時執行。"],
    ]
    items = heading(
        "14",
        "更換遊戲時要修改與確認什麼",
        "不需要重裝 GamerCatch。先備份目前可用的 config.toml，再只修改要更換的 [[games]] 區塊。",
    ) + [
        callout(
            "第一步先關閉寫入",
            "把新遊戲的 write_to_google_sheets 改成 false。確認抓到正確遊戲前，不要讓它寫入任何試算表。",
            "warning",
        ),
        Spacer(1, 4 * mm),
        data_table(["要檢查的設定", "換遊戲時怎麼改"], rows, [48 * mm, 117 * mm]),
        Spacer(1, 5 * mm),
        p("改完後依序確認", "h2"),
        step(1, "先確認權限與日期", "新試算表已分享給正確 client_email，而且今天日期列已存在。"),
        step(2, "先做不寫入測試", f"儲存 config.toml，雙擊 {MACOS_RUN_SCRIPT if platform == 'macOS' else WINDOWS_RUN_SCRIPT}，核對遊戲名稱、排行、人氣與 page。"),
        step(3, "一次只開一個正式寫入", "測試正確後，只把新遊戲的 write_to_google_sheets 改成 true，再核對寫入的試算表、分頁、日期列與欄位。"),
        step(4, "找不到時再擴大頁數", "先確認 game_name 完全相同，再逐步提高 end_page；不要一開始就設成最大值。"),
    ]
    if platform == "Windows":
        items += [
            Spacer(1, 4 * mm),
            callout(
                "只改 config.toml 不必重裝 Task",
                f"每日排程每次都會讀取同一份 config.toml。只有搬動資料夾或換到新版資料夾時，才要重新雙擊 {WINDOWS_SCHEDULE_LAUNCHER}。",
                "success",
            ),
        ]
    items += [PageBreak()]
    return items


def troubleshoot_page(platform: str):
    rows = [
        ["發行檔不完整", "完整解壓縮整個資料夾；不要單獨移動腳本或主程式。"],
        ["Chromium 安裝失敗", "確認網路、代理與磁碟空間，再雙擊首次設定。"],
        ["設定檔格式錯誤", "對照 config.example.toml，檢查雙引號、等號與 [[games]]。"],
        ["找不到遊戲", "遊戲名稱需與巴哈完全相同；必要時提高 end_page。"],
        ["找不到 JSON", "確認 credentials 路徑、檔名與是否誤成 .json.json。"],
        ["JSON 格式錯誤", "OAuth 用戶端或 API key 不能替代 service account JSON。"],
        ["Google 403", "確認 Sheets API 已啟用，且試算表以編輯者分享給正確 client_email。"],
        ["工作表不存在", "worksheet_name 必須和試算表底部分頁完全相同。"],
        ["找不到今天日期", "先加入今天，並檢查時區、日期欄與 first_data_row。"],
        ["日期重複", "今天只能出現一次；修正重複日期列後重試。"],
        ["輸出欄位重疊", "同一試算表與同一分頁的不同遊戲不可共用排行或人氣欄。"],
    ]
    if platform == "Windows":
        rows += [
            ["排程沒有在 09:00 執行", "確認目前帳號仍登入、Task 未停用，以及電腦、網路與喚醒設定可用。"],
            ["排程執行但沒有寫入", f"查看 {WINDOWS_SCHEDULE_LOG}，再檢查今天日期、write_to_google_sheets 與 CAPTCHA。"],
            ["PowerShell 被公司封鎖", "請聯絡 IT 管理員；不要改成 Unrestricted、停用防毒或用系統管理員強行繞過。"],
        ]
    return heading("15", "常見錯誤快速對照") + [
        data_table(["看到的訊息", "怎麼處理"], rows, [52 * mm, 113 * mm]),
        Spacer(1, 4 * mm),
        callout(
            "其中一個人失敗，不代表全部失敗",
            "程式會繼續處理其他遊戲，最後再彙整失敗項目。請依遊戲名稱修正對應的 JSON、試算表或設定。",
            "info",
        ),
        PageBreak(),
    ]


def security_page(platform: str):
    log_name = (
        "last-run.log 或 last-scheduled-run.log"
        if platform == "Windows"
        else "last-run.log"
    )
    update_schedule_note = (
        f"Windows 使用者還要在新版資料夾重新雙擊 {WINDOWS_SCHEDULE_LAUNCHER}，更新 Task 路徑。"
        if platform == "Windows"
        else ""
    )
    return heading("16", "私鑰安全、更新與求助") + [
        p("如果懷疑 JSON 外洩", "h2"),
        step(1, "立刻撤銷舊金鑰", "到 Google Cloud 的 service account「金鑰」頁面，停用或刪除舊金鑰。"),
        step(2, "建立新 JSON", "下載新金鑰，替換 credentials 裡的舊檔。試算表已分享給同一 service account 時，通常不需要重新分享。"),
        p("更新 GamerCatch", "h2"),
        bullet("先備份舊資料夾中的 config.toml 與整個 credentials。"),
        bullet("把新版解壓縮到新資料夾，不要直接覆蓋舊版。"),
        bullet(f"複製自己的設定與 JSON 到新版，先以 write_to_google_sheets=false 測試。{update_schedule_note}"),
        p("求助時可以提供", "h2"),
        bullet(f"作業系統 {platform}、x64 / arm64，以及 GitHub Release 版本。"),
        bullet(f"完整錯誤畫面或 {log_name}。上傳前仍應檢查是否含個人路徑。"),
        bullet("隱藏試算表網址後的 config.toml。"),
        callout(
            "絕對不要提供",
            "service account JSON、private_key、完整私鑰、可編輯的 Google Sheet 公開連結。",
            "danger",
        ),
        PageBreak(),
    ]


def checklist_page(platform: str):
    starter = "1_首次設定.command" if platform == "macOS" else "1_首次設定.cmd"
    runner = MACOS_RUN_SCRIPT if platform == "macOS" else WINDOWS_RUN_SCRIPT
    rows = [
        ["□", "已完整解壓縮，沒有直接在 ZIP 裡執行。"],
        ["□", f"已雙擊 {starter} 並完成 Chromium 準備。"],
        ["□", "每位使用者的 Cloud 專案都已啟用 Google Sheets API。"],
        ["□", "每份 JSON 都是 service account key，並放在 credentials。"],
        ["□", "每張試算表都已分享給正確 client_email，權限為編輯者。"],
        ["□", "config.toml 的遊戲、網址、分頁、JSON 與欄位配對正確。"],
        ["□", "第一次測試時所有 write_to_google_sheets 都是 false。"],
        ["□", "已確認每個遊戲的排行與人氣正確。"],
        ["□", "已逐一開啟 true，並在每張試算表核對今天資料。"],
        ["□", f"平常只需雙擊 {runner}。"],
    ]
    if platform == "Windows":
        rows.append(
            [
                "□",
                f"若要自動執行，已用 {WINDOWS_SCHEDULE_LAUNCHER} 確認目前帳號與每日 09:00。",
            ]
        )
    return heading("完成", "最後檢查表") + [
        data_table(
            ["完成", "檢查項目"],
            rows,
            [18 * mm, 147 * mm],
        ),
        Spacer(1, 7 * mm),
        p("官方參考資料", "h2"),
        p(
            "Google Workspace 建立憑證：<link href='https://developers.google.com/workspace/guides/create-credentials'>developers.google.com/workspace/guides/create-credentials</link>",
            "link",
        ),
        p(
            "Google Cloud 建立 JSON 金鑰：<link href='https://docs.cloud.google.com/iam/docs/keys-create-delete'>docs.cloud.google.com/iam/docs/keys-create-delete</link>",
            "link",
        ),
        p(
            "Google Sheets 分享檔案：<link href='https://support.google.com/a/users/answer/13309904'>support.google.com/a/users/answer/13309904</link>",
            "link",
        ),
        Spacer(1, 10 * mm),
        callout(
            "完成",
            "您已經把多遊戲、多人的 Google Sheets 完整分開設定。日後新增或更換遊戲，請依第 14 章修改並重新做安全測試。",
            "success",
        ),
    ]


def story(platform: str):
    parts = []
    sections = [
        cover(platform),
        download_page(platform),
        safety_page(platform),
        prep_page(),
        sheet_page(),
        google_cloud_page(),
        service_account_page(),
        sharing_page(),
        credentials_page(platform),
        config_rules_page(),
        config_fields_page(),
        config_examples_page(),
        dry_run_page(platform),
        production_page(platform),
    ]
    if platform == "Windows":
        sections.append(windows_schedule_page())
    sections += [
        change_game_page(platform),
        troubleshoot_page(platform),
        security_page(platform),
        checklist_page(platform),
    ]
    for section in sections:
        parts.extend(section)
    return parts


def generate(platform: str, filename: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / filename
    doc = ManualDocTemplate(str(output), platform)
    doc.build(story(platform))
    return output


def main() -> None:
    outputs = [
        generate("macOS", "GamerCatch_零基礎使用手冊_macOS.pdf"),
        generate("Windows", "GamerCatch_零基礎使用手冊_Windows.pdf"),
    ]
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
