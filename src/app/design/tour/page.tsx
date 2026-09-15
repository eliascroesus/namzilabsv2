import { PageContainer, SectionHeading } from "@/components/ui/page";
import { TourStage } from "./stage";

/**
 * THE FIRST-RUN TOUR, ON A PUBLIC ROUTE.
 *
 * `/dashboard` is behind WorkOS and only shows this to a workspace with no
 * connections, so nothing outside a session with a brand-new tenant could ever
 * look at it. That is precisely the shape of thing this repo keeps shipping
 * broken: every check here greps SOURCE, so a spotlight positioned into the
 * corner of the screen passes the suite and fails the eye. The refer board's
 * progress bar was invisible at 1.1:1 with a green test beside it.
 *
 * So the real component renders here, against stand-in anchors laid out where
 * the rail and the top bar put the real ones — the left column and the top
 * right. What is being checked is the thing that cannot be checked by reading:
 * does the bubble land beside its target, does the dim actually dim, and does
 * the highlight sit ON the element rather than near it.
 *
 * The anchors are stand-ins rather than a copy of the rail because the rail
 * needs a session; their POSITIONS are what the geometry depends on, and those
 * are real.
 */
export const dynamic = "force-dynamic";

export default function TourDesignPage() {
  return (
    <PageContainer>
      <SectionHeading>First-run tour</SectionHeading>
      <p className="mb-6 text-sm text-muted-foreground">
        The real component against stand-in anchors. Step through it — the spotlight should sit on each target and the
        bubble beside it.
      </p>
      <TourStage />
    </PageContainer>
  );
}
