import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { courseUnlocked, effectiveCeHours, getCourse } from "@/lib/education";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Downloadable certificate of completion (PDF). Same gate as the printable
 * page: every lesson complete, course unlocked for the viewer's tier. Drawn
 * with pdf-lib in the brand palette (navy #0B1622, gold #B8965A, cream).
 */

const NAVY = { r: 11 / 255, g: 22 / 255, b: 34 / 255 };
const GOLD = { r: 184 / 255, g: 150 / 255, b: 90 / 255 };
const CREAM = { r: 248 / 255, g: 246 / 255, b: 241 / 255 };
const INK = { r: 26 / 255, g: 35 / 255, b: 50 / 255 };

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const course = await getCourse(params.id);
  if (!course || (!course.published && !member.isAdmin)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!courseUnlocked(course, member.tier)) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }
  const complete =
    course.lessons.length > 0 && course.lessons.every((l) => l.completed);
  if (!complete) {
    return NextResponse.json(
      { error: "Finish every lesson to earn the certificate." },
      { status: 403 },
    );
  }

  // Completion date = latest lesson completion (own rows only).
  let completedOn = new Date();
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data } = user
      ? await supabase
          .from("lesson_progress")
          .select("completed_at")
          .eq("profile_id", user.id)
          .in(
            "lesson_id",
            course.lessons.map((l) => l.id),
          )
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    if (data?.completed_at) completedOn = new Date(data.completed_at);
  }
  const dateLabel = completedOn.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const hours = effectiveCeHours(course);

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(`Momentum+ Certificate — ${course.title}`);
  const page = doc.addPage([792, 612]); // US Letter landscape
  const { width, height } = page.getSize();
  const serif = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const navy = rgb(NAVY.r, NAVY.g, NAVY.b);
  const gold = rgb(GOLD.r, GOLD.g, GOLD.b);
  const ink = rgb(INK.r, INK.g, INK.b);

  // Cream field with a double gold border.
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(CREAM.r, CREAM.g, CREAM.b) });
  page.drawRectangle({
    x: 24, y: 24, width: width - 48, height: height - 48,
    borderColor: gold, borderWidth: 2,
  });
  page.drawRectangle({
    x: 32, y: 32, width: width - 64, height: height - 64,
    borderColor: gold, borderWidth: 0.75,
  });

  const centerText = (
    text: string,
    y: number,
    font: typeof sans,
    size: number,
    color = ink,
  ) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - w) / 2, y, size, font, color });
  };

  centerText("Momentum+", height - 100, serifBold, 34, navy);
  centerText(
    "SIERRA LEARNERSHIP COLLABORATIVE",
    height - 124,
    sans,
    9,
    gold,
  );
  centerText("CERTIFICATE OF COMPLETION", height - 172, sansBold, 14, gold);
  centerText("This certifies that", height - 210, serif, 13, ink);
  centerText(member.name, height - 250, serifBold, 30, navy);
  centerText("has successfully completed the course", height - 284, serif, 13, ink);

  // Course title (wraps once if long).
  const titleSize = 20;
  if (serifBold.widthOfTextAtSize(course.title, titleSize) <= width - 160) {
    centerText(course.title, height - 320, serifBold, titleSize, navy);
  } else {
    const words = course.title.split(" ");
    let line1 = "";
    let line2 = "";
    for (const w of words) {
      const attempt = line1 ? `${line1} ${w}` : w;
      if (!line2 && serifBold.widthOfTextAtSize(attempt, titleSize) <= width - 160) {
        line1 = attempt;
      } else {
        line2 = line2 ? `${line2} ${w}` : w;
      }
    }
    centerText(line1, height - 316, serifBold, titleSize, navy);
    centerText(line2, height - 340, serifBold, titleSize, navy);
  }

  if (hours !== null && hours > 0) {
    centerText(
      `${hours} educational hour${hours === 1 ? "" : "s"}`,
      height - 372,
      sansBold,
      11,
      gold,
    );
  }
  centerText(`Completed ${dateLabel}`, height - 396, sans, 11, ink);

  // Signature block.
  const sigY = 96;
  page.drawLine({
    start: { x: width / 2 - 130, y: sigY + 18 },
    end: { x: width / 2 + 130, y: sigY + 18 },
    thickness: 0.75,
    color: gold,
  });
  centerText("Sierra Collins", sigY + 26, serif, 16, navy);
  centerText("Momentum+ Education", sigY, sans, 9, ink);

  const bytes = await doc.save();
  const filename = `momentum-plus-certificate-${course.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
