"use client";

import Link from "next/link";
import { useState } from "react";

import { LazyGL } from "./gl/lazy-gl";
import { Pill } from "./pill";
import { Button } from "./ui/button";

export function Hero() {
  const [hovering, setHovering] = useState(false);

  return (
    <div className="relative flex flex-col h-svh justify-between">
      <LazyGL hovering={hovering} />

      <div className="pb-16 mt-auto text-center relative z-10 container">
        <Pill className="mb-6">ARC MAINNET</Pill>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-sentient leading-[0.95]">
          Payments,
          <br />
          <i className="font-light">without the friction.</i>
        </h1>

        <p className="font-mono text-sm sm:text-base text-foreground/70 text-balance mt-8 max-w-[460px] mx-auto">
          Create a payment link. Share it anywhere.
          <br className="hidden sm:block" />
          Receive USDC directly on Arc.
        </p>

        <Link
          className="contents max-sm:hidden"
          href="/create"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <Button className="mt-14">[ CREATE PAYMENT ]</Button>
        </Link>

        <Link
          className="contents sm:hidden"
          href="/create"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <Button size="sm" className="mt-14">
            [ CREATE PAYMENT ]
          </Button>
        </Link>
      </div>
    </div>
  );
}
