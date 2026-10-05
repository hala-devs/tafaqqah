import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

const LOGO_SRC = "/brand/tafaqqah-logo.png";
const LOGO_WIDTH = 1536;
const LOGO_HEIGHT = 1024;

/** The supplied Tafaqqah artwork, rendered at its intrinsic aspect ratio. */
export function Logo({
  href = "/",
  className,
  imageClassName,
  ariaLabel = "تفقّه — الصفحة الرئيسية",
}: {
  href?: string;
  className?: string;
  imageClassName?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-dark", className)}
      aria-label={ariaLabel}
    >
      <Image
        src={LOGO_SRC}
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        alt="تفقّه"
        sizes="(max-width: 640px) 80px, 96px"
        className={cn("h-auto w-20 sm:w-24", imageClassName)}
      />
    </Link>
  );
}
