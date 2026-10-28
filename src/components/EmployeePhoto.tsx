import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";

export function EmployeePhoto({
  path,
  name,
  className,
}: {
  path?: string | null;
  name: string;
  className?: string;
}) {
  const photoQuery = useQuery({
    queryKey: ["employee-photo", path],
    enabled: Boolean(path),
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      if (!path) return null;
      const { data, error } = await supabase.storage
        .from("employee-documents")
        .createSignedUrl(path, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <Avatar
      className={className}
      title={photoQuery.error ? "Employee photo could not be loaded" : name}
    >
      <AvatarImage src={photoQuery.data ?? undefined} alt={`${name} photo`} />
      <AvatarFallback aria-label={`${name} photo unavailable`}>{initials}</AvatarFallback>
    </Avatar>
  );
}
