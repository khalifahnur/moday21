import Monday21 from "@/components/Monday21";

export default function Page() {
  return <Monday21 turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined} />;
}
