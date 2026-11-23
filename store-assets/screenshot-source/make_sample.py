import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.colors import HexColor
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak

INK, GREY = HexColor("#1f2430"), HexColor("#6b6f7a")
title = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=26, leading=31, textColor=INK, spaceAfter=6)
sub = ParagraphStyle("s", fontName="Helvetica", fontSize=13, leading=18, textColor=GREY, spaceAfter=26)
h = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=15, leading=20, textColor=INK, spaceBefore=8, spaceAfter=10)
body = ParagraphStyle("b", fontName="Times-Roman", fontSize=11.5, leading=16.5, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=10)
small = ParagraphStyle("m", parent=body, fontSize=10, leading=14, textColor=GREY)

def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8.5); canvas.setFillColor(GREY)
    canvas.drawString(72, 750, "Urban Tree Canopy — A field guide for neighbourhood planning")
    canvas.drawRightString(540, 750, "Sample document for illustration")
    canvas.drawCentredString(306, 40, str(doc.page))
    canvas.restoreState()

doc = BaseDocTemplate(sys.argv[1], pagesize=letter, leftMargin=72, rightMargin=72, topMargin=80, bottomMargin=64,
                      title="Urban Tree Canopy", author="Sample document")
doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(72, 64, 468, 648, id="f")], onPage=chrome)])
P = lambda text, style=body: Paragraph(text, style)
s = []
s += [P("Urban Tree Canopy", title), P("A field guide for neighbourhood planning", sub),
      P("<b>Summary.</b> Street trees cool neighbourhoods, slow storm water and make walking pleasant, but they are planted "
        "unevenly. This guide explains how to measure the canopy a neighbourhood already has, where new trees will do the "
        "most good, and how residents can keep them healthy through their first ten years."),
      P("The chapters can be read in any order. Each one ends with a short checklist that planning groups can copy into "
        "their own notes. Figures are rounded and drawn from illustrative surveys; they show the method, not a particular city."),
      Spacer(1, 10), P("Contents", h),
      P("1&nbsp;&nbsp;Why canopy matters<br/>2&nbsp;&nbsp;Measuring shade<br/>3&nbsp;&nbsp;Choosing species<br/>"
        "4&nbsp;&nbsp;Soil and water<br/>5&nbsp;&nbsp;Looking after young trees<br/>6&nbsp;&nbsp;Working with residents"),
      PageBreak()]
s += [P("1&nbsp;&nbsp;Why canopy matters", h),
      P("A mature street tree intercepts rain, shades the pavement and filters the noise of passing traffic. None of these "
        "benefits arrive at once: a sapling planted this spring will not cast useful shade for six or seven summers, which is "
        "why planting decisions made today shape a street for decades."),
      P("Canopy is also a question of fairness. Neighbourhoods built quickly, or with narrow pavements, often have far fewer "
        "trees than older streets nearby. Residents notice the difference on the hottest afternoons, when a bus stop without "
        "shade can be several degrees warmer than one under a plane tree."),
      P("Planning groups therefore need two things before they plant: an honest picture of the canopy they already have, and "
        "a shared idea of where new trees would help the most people. The next chapter describes a simple way to get both."),
      PageBreak()]
s += [P("2&nbsp;&nbsp;Measuring shade", h),
      P("Start with a walk rather than a spreadsheet. Two volunteers can survey a street in under an hour, noting each tree, "
        "its rough height and the stretch of pavement it covers at noon. Combined, these notes become a shade map: a plan of "
        "the neighbourhood with every shaded stretch of pavement coloured in."),
      P("In our illustrative survey, streets with continuous canopy were on average 4&nbsp;°C cooler at midday than comparable "
        "streets without trees, and the difference lasted well into the evening. Gaps of even a few houses broke the effect, "
        "so continuity matters more than the size of any single tree."),
      P("Repeat the survey every few years. A shade map that is updated after each planting season shows residents what has "
        "changed, and keeps attention on the streets that still have none."),
      PageBreak()]
s += [P("3&nbsp;&nbsp;Choosing species", h),
      P("The right tree is the one that will still be healthy in forty years. Choose species that tolerate drought, compacted "
        "soil and road salt, and avoid planting a single species along a whole street: a mix of four or five protects the "
        "canopy if one of them falls to disease."),
      P("Use the shade map to match trees to places. Wide pavements on the sunny side of a street can take large, broad "
        "crowns; narrow pavements and spots under power lines need smaller, upright varieties that will not need heavy pruning."),
      PageBreak()]
s += [P("4&nbsp;&nbsp;Soil and water", h),
      P("Most young street trees fail below ground. A planting pit that is too small, or soil sealed under paving, leaves "
        "roots with nowhere to go. Wherever possible, connect pits under the pavement so roots can share a larger volume of soil."),
      P("Water generously for the first three summers. A single slow soak each week does more good than frequent light "
        "watering, because it encourages roots to grow downwards rather than staying near the surface."),
      PageBreak()]
s += [P("5&nbsp;&nbsp;Looking after young trees", h),
      P("Check stakes and ties every spring and remove them once the trunk can stand on its own, usually after two years. "
        "A tie left too long cuts into the bark as the tree grows."),
      P("Record losses on the shade map as well as plantings. A street where several young trees have died needs a different "
        "approach, often better soil or a hardier species, not simply another replacement."),
      PageBreak()]
s += [P("6&nbsp;&nbsp;Working with residents", h),
      P("Trees planted with neighbours tend to survive. Invite residents to choose locations on the shade map, and give each "
        "new tree a named caretaker who will water it in dry weeks and report damage early."),
      P("Share results openly. A short note each autumn, listing new trees, losses and the streets planned for next year, "
        "builds the trust that long planting programmes depend on."),
      Spacer(1, 18), P("This is a sample document created to illustrate PDF Page and Passage Links. Figures are illustrative.", small)]
doc.build(s)
print("ok")
