"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markLessonOpened } from "@/app/(portal)/education/actions";

/*
 * Lessons without a test complete automatically: opening the lesson counts
 * as reading the information / starting the video. Fires once per mount.
 */
export function LessonAutoComplete({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void markLessonOpened(lessonId).then((res) => {
      if (res.ok && !res.preview) router.refresh();
    });
  }, [lessonId, router]);

  return null;
}
