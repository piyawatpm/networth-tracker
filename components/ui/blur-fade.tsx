"use client";

import { useRef, type ReactNode } from "react";
import {
  motion,
  useInView,
  type Variant,
} from "motion/react";
import { cn } from "@/lib/utils";

interface BlurFadeProps {
  children: ReactNode;
  className?: string;
  variant?: {
    hidden: Variant;
    visible: Variant;
  };
  duration?: number;
  delay?: number;
  yOffset?: number;
  blur?: string;
  inView?: boolean;
  inViewMargin?: string;
}

export function BlurFade({
  children,
  className,
  variant,
  duration = 0.4,
  delay = 0,
  yOffset = 6,
  blur = "6px",
  inView = false,
  inViewMargin = "-50px",
}: BlurFadeProps) {
  const ref = useRef(null);
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin as `${number}px` });
  const isInView = !inView || inViewResult;

  const defaultVariants = {
    hidden: {
      y: yOffset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: {
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
    },
  };

  const activeVariants = variant || defaultVariants;

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      exit="hidden"
      variants={activeVariants}
      transition={{
        delay: 0.04 + delay,
        duration,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
