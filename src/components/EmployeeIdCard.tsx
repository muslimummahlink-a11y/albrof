import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const CARD_WIDTH = 1012;
const CARD_HEIGHT = 638;

export type IdCardEmployee = {
  employee_no: string;
  full_name: string;
  position: string;
  department: string;
  phone: string | null;
  status: string;
};
export type CardSide = "front" | "back";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The ID card image could not be loaded."));
    image.src = src;
  });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawInitials(context: CanvasRenderingContext2D, name: string, x: number, y: number) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  context.fillStyle = "#ffffff";
  context.font = "700 68px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(initials || "HS", x, y);
}

function drawBackground(context: CanvasRenderingContext2D, image?: HTMLImageElement | null) {
  if (!image) {
    const gradient = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    gradient.addColorStop(0, "#0c1117");
    gradient.addColorStop(0.5, "#101821");
    gradient.addColorStop(1, "#172330");
    context.fillStyle = gradient;
    context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    context.fillStyle = "rgba(245, 158, 11, 0.18)";
    for (let x = 0; x < CARD_WIDTH; x += 56) {
      context.fillRect(x, 0, 24, CARD_HEIGHT);
    }
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    context.fillRect(0, 112, CARD_WIDTH, 2);
    context.fillRect(0, 404, CARD_WIDTH, 2);
    return;
  }

  const scale = Math.max(CARD_WIDTH / image.width, CARD_HEIGHT / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (CARD_WIDTH - width) / 2, (CARD_HEIGHT - height) / 2, width, height);
}

function fillFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  weight: number,
  family: string,
) {
  let size = maxSize;
  context.font = `${weight} ${size}px ${family}`;
  while (size > minSize && context.measureText(text).width > maxWidth) {
    size -= 1;
    context.font = `${weight} ${size}px ${family}`;
  }
  context.fillText(text, x, y);
}

function drawFront(
  context: CanvasRenderingContext2D,
  employee: IdCardEmployee,
  issuedAt: string,
  stadium: HTMLImageElement | null,
  photo: HTMLImageElement | null,
) {
  drawBackground(context, stadium);
  context.fillStyle = "rgba(250, 251, 253, 0.91)";
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  context.fillStyle = "#14283d";
  context.fillRect(0, 0, CARD_WIDTH, 126);
  context.fillStyle = "#d71920";
  context.fillRect(0, 126, 338, 7);
  context.fillStyle = "#f1c232";
  context.fillRect(338, 126, 338, 7);
  context.fillStyle = "#ffffff";
  context.fillRect(676, 126, CARD_WIDTH - 676, 7);

  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  context.font = "700 29px Arial, sans-serif";
  context.fillText("BMP MEDIA PRODUCTION", 54, 55);
  context.fillStyle = "#c9d4df";
  context.font = "600 14px Arial, sans-serif";
  context.fillText("STAFF CREDENTIAL", 56, 82);
  context.fillStyle = "#ffffff";
  context.textAlign = "right";
  context.font = "700 14px Arial, sans-serif";
  context.fillText("UGANDA", 958, 54);
  context.fillStyle = "#c9d4df";
  context.font = "600 12px Arial, sans-serif";
  context.fillText("OFFICIAL STAFF IDENTIFICATION", 958, 78);
  context.fillStyle = "#f1c232";
  context.fillRect(906, 92, 52, 3);

  const photoX = 54;
  const photoY = 160;
  const photoWidth = 222;
  const photoHeight = 280;
  roundedRect(context, photoX - 5, photoY - 5, photoWidth + 10, photoHeight + 10, 7);
  context.fillStyle = "#ffffff";
  context.fill();
  context.strokeStyle = "#c7d0da";
  context.lineWidth = 2;
  context.stroke();
  context.save();
  roundedRect(context, photoX, photoY, photoWidth, photoHeight, 4);
  context.clip();
  context.fillStyle = "#e7edf3";
  context.fillRect(photoX, photoY, photoWidth, photoHeight);
  const photoGradient = context.createLinearGradient(
    photoX,
    photoY,
    photoX + photoWidth,
    photoY + photoHeight,
  );
  photoGradient.addColorStop(0, "#344b63");
  photoGradient.addColorStop(1, "#14283d");
  context.fillStyle = photoGradient;
  context.fillRect(photoX, photoY, photoWidth, photoHeight);
  if (photo) {
    const scale = Math.max(photoWidth / photo.width, photoHeight / photo.height);
    const width = photo.width * scale;
    const height = photo.height * scale;
    context.drawImage(
      photo,
      photoX + (photoWidth - width) / 2,
      photoY + (photoHeight - height) / 2,
      width,
      height,
    );
  } else {
    drawInitials(context, employee.full_name, photoX + photoWidth / 2, photoY + photoHeight / 2);
  }
  context.restore();

  const detailX = 320;
  const detailRight = 956;
  context.textAlign = "left";
  context.fillStyle = "#637386";
  context.font = "700 13px Arial, sans-serif";
  context.fillText("FULL NAME", detailX, 174);
  context.fillStyle = "#14283d";
  fillFittedText(
    context,
    employee.full_name.toUpperCase(),
    detailX,
    219,
    detailRight - detailX,
    34,
    23,
    700,
    "Arial, sans-serif",
  );
  context.fillStyle = "#344b63";
  fillFittedText(
    context,
    employee.position.toUpperCase(),
    detailX,
    255,
    detailRight - detailX,
    22,
    15,
    600,
    "Arial, sans-serif",
  );

  context.fillStyle = "#c5ced8";
  context.fillRect(detailX, 280, detailRight - detailX, 2);
  context.fillStyle = "#637386";
  context.font = "700 12px Arial, sans-serif";
  context.fillText("DEPARTMENT", detailX, 311);
  context.fillText("EMPLOYEE NUMBER", 650, 311);
  context.fillStyle = "#14283d";
  fillFittedText(context, employee.department, detailX, 340, 290, 19, 13, 600, "Arial, sans-serif");
  fillFittedText(
    context,
    employee.employee_no.toUpperCase(),
    650,
    340,
    detailRight - 650,
    21,
    14,
    700,
    "'Courier New', monospace",
  );

  roundedRect(context, detailX, 374, 112, 34, 17);
  context.fillStyle = employee.status === "active" ? "#e5f2ed" : "#f7e7e5";
  context.fill();
  context.fillStyle = employee.status === "active" ? "#22664d" : "#943f38";
  context.textAlign = "center";
  context.font = "700 12px Arial, sans-serif";
  context.fillText(employee.status === "active" ? "ACTIVE STAFF" : "INACTIVE", detailX + 56, 396);

  context.textAlign = "left";
  context.fillStyle = "#637386";
  context.font = "700 12px Arial, sans-serif";
  context.fillText("CARD ISSUE DATE", detailX, 455);
  context.fillStyle = "#14283d";
  context.font = "600 17px Arial, sans-serif";
  context.fillText(issuedAt, detailX, 480);
  context.fillStyle = "#637386";
  context.font = "600 12px Arial, sans-serif";
  context.fillText("Valid while employed · Return to BMP administration", detailX, 511, 620);

  context.fillStyle = "#14283d";
  context.fillRect(0, 548, CARD_WIDTH, 90);
  context.fillStyle = "#d71920";
  context.fillRect(0, 548, 338, 5);
  context.fillStyle = "#f1c232";
  context.fillRect(338, 548, 338, 5);
  context.fillStyle = "#ffffff";
  context.fillRect(676, 548, CARD_WIDTH - 676, 5);
  context.textAlign = "left";
  context.font = "700 14px Arial, sans-serif";
  context.fillText("BMP MEDIA PRODUCTION", 54, 586);
  context.fillStyle = "#c9d4df";
  context.font = "600 11px Arial, sans-serif";
  context.fillText("STAFF IDENTIFICATION · NOT A NATIONAL ID", 54, 610);
  context.textAlign = "right";
  context.fillStyle = "#ffffff";
  context.font = "600 13px Arial, sans-serif";
  context.fillText("PROPERTY OF BMP MEDIA PRODUCTION", 958, 586);
  context.fillStyle = "#c9d4df";
  context.font = "500 11px Arial, sans-serif";
  context.fillText("If found, return to BMP administration", 958, 610);
}

function drawBack(
  context: CanvasRenderingContext2D,
  employee: IdCardEmployee,
  stadium: HTMLImageElement | null,
) {
  drawBackground(context, stadium);
  context.fillStyle = "rgba(8, 20, 37, 0.82)";
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  context.fillStyle = "#d71920";
  context.fillRect(0, 0, 12, CARD_HEIGHT);
  context.fillStyle = "#f3c343";
  context.fillRect(12, 0, 8, CARD_HEIGHT);
  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  context.font = "800 31px Arial, sans-serif";
  context.fillText("BMP MEDIA PRODUCTION", 56, 72);
  context.fillStyle = "#f3c343";
  context.font = "700 16px Arial, sans-serif";
  context.fillText("OFFICIAL STAFF IDENTIFICATION · UGANDA", 58, 103);

  context.textAlign = "left";
  context.fillStyle = "#d71920";
  context.fillRect(56, 193, CARD_WIDTH - 112, 4);
  context.fillStyle = "#f3c343";
  context.fillRect(56, 197, CARD_WIDTH - 112, 3);
  context.fillStyle = "#ffffff";
  context.font = "700 25px Arial, sans-serif";
  context.fillText("TERMS OF USE", 56, 239);
  context.fillStyle = "#e4edf7";
  context.font = "500 19px Arial, sans-serif";
  context.fillText("This card remains the property of BMP Media Production.", 56, 283);
  context.fillText("Display it while on duty and return it when requested.", 56, 316);
  context.fillText("If found, please return it to the BMP administration.", 56, 349);

  context.fillStyle = "#f3c343";
  context.fillRect(56, 387, 408, 2);
  context.fillStyle = "#aabbd0";
  context.font = "700 15px Arial, sans-serif";
  context.fillText("CARD HOLDER", 56, 422);
  context.fillStyle = "#ffffff";
  context.font = "700 21px Arial, sans-serif";
  context.fillText(employee.full_name.toUpperCase().slice(0, 30), 56, 453);
  context.fillStyle = "#aabbd0";
  context.font = "700 15px Arial, sans-serif";
  context.fillText("STAFF NUMBER", 540, 422);
  context.fillStyle = "#ffffff";
  context.font = "700 21px 'Courier New', monospace";
  context.fillText(employee.employee_no.toUpperCase().slice(0, 25), 540, 453);

  context.fillStyle = "#d71920";
  context.fillRect(56, 493, CARD_WIDTH - 112, 2);
  context.fillStyle = "#f3c343";
  context.fillRect(56, 495, CARD_WIDTH - 112, 2);
  context.fillStyle = "#ffffff";
  context.font = "700 17px Arial, sans-serif";
  context.fillText("Powered by TennaHub Technologies LTD", 56, 535);
  context.fillStyle = "#b9cee5";
  context.font = "600 16px Arial, sans-serif";
  context.fillText("www.tennahubapps.com", 56, 564);
  context.textAlign = "right";
  context.fillStyle = "#dbe7f3";
  context.font = "600 15px Arial, sans-serif";
  context.fillText("OFFICIAL STAFF CREDENTIAL", 956, 564);
}

export function EmployeeIdCard({
  employee,
  issuedAt,
  photoUrl,
}: {
  employee: IdCardEmployee;
  issuedAt: string;
  photoUrl: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [side, setSide] = useState<CardSide>("front");
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function renderCard() {
      try {
        const photoImage = photoUrl ? await loadImage(photoUrl) : null;
        if (cancelled) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("This browser cannot render an ID card image.");
        canvas.width = CARD_WIDTH;
        canvas.height = CARD_HEIGHT;
        if (side === "front") drawFront(context, employee, issuedAt, null, photoImage);
        else drawBack(context, employee, null);
        setRenderError("");
      } catch (error) {
        if (cancelled) return;
        setRenderError(error instanceof Error ? error.message : "Could not render the ID card.");
      }
    }
    void renderCard();
    return () => {
      cancelled = true;
    };
  }, [employee, issuedAt, photoUrl, side]);

  async function downloadJpg(downloadSide: CardSide) {
    try {
      const photoImage = photoUrl ? await loadImage(photoUrl) : null;
      const canvas = document.createElement("canvas");
      canvas.width = CARD_WIDTH;
      canvas.height = CARD_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot render an ID card image.");
      if (downloadSide === "front") drawFront(context, employee, issuedAt, null, photoImage);
      else drawBack(context, employee, null);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("Could not create JPG image."))),
          "image/jpeg",
          0.96,
        );
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeName = employee.employee_no.replace(/[^a-z0-9-]/gi, "_");
      anchor.href = url;
      anchor.download = `bmp-media-production-${safeName}-${downloadSide}.jpg`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the ID card JPG.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="employee-id-print overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-xl">
        <canvas
          ref={canvasRef}
          aria-label={`BMP Media Production staff ID card ${side}`}
          className="block aspect-[1012/638] w-full bg-white"
        />
      </div>
      {renderError && <p className="text-sm text-destructive">{renderError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border bg-background p-1">
          {(["front", "back"] as const).map((cardSide) => (
            <button
              key={cardSide}
              type="button"
              aria-pressed={side === cardSide}
              onClick={() => setSide(cardSide)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                side === cardSide ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {cardSide}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border px-3 py-2 text-xs font-semibold"
          >
            Print {side}
          </button>
          <button
            type="button"
            onClick={() => void downloadJpg("front")}
            disabled={Boolean(renderError)}
            className="rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Download front JPG
          </button>
          <button
            type="button"
            onClick={() => void downloadJpg("back")}
            disabled={Boolean(renderError)}
            className="rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Download back JPG
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Standard CR80 landscape size · 1012 × 638 px at print-ready resolution
      </p>
    </div>
  );
}
