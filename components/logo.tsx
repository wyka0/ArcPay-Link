import type { SVGProps } from "react";

/**
 * ArcPay Link logo mark.
 *
 * An original monogram built from payment-link geometry: two linked nodes
 * joined by a path that reads as an "A". Not derived from the Skal mark.
 */
export const Logo = (props: SVGProps<SVGSVGElement>) => {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ArcPay Link"
      {...props}
    >
      {/* Link path forming the apex of the A */}
      <path
        d="M11 30.5 L20 10.5 L29 30.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
      />
      {/* Crossbar / linked chain segment */}
      <path
        d="M15.2 23.4 H24.8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
      />
      {/* Left node */}
      <rect
        x="7.4"
        y="26.9"
        width="7.2"
        height="7.2"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      {/* Right node */}
      <rect
        x="25.4"
        y="26.9"
        width="7.2"
        height="7.2"
        stroke="currentColor"
        strokeWidth="2.2"
      />
    </svg>
  );
};

/** Wordmark + mark lockup used in the header. */
export const LogoLockup = ({ className }: { className?: string }) => {
  return (
    <span className={className}>
      <Logo className="h-7 w-7 shrink-0 text-primary md:h-9 md:w-9" />
      <span className="text-[18px] font-medium tracking-tight text-foreground md:text-[22px]">
        ArcPay Link
      </span>
    </span>
  );
};
