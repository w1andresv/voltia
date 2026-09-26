import { useQuery } from "@tanstack/react-query";
import { getPlugshareStatusFn } from "@/server/actions/chargers";

/** ¿El servidor tiene PLUGSHARE_TOKEN? El navegador no maneja credenciales de PlugShare. */
export function usePlugshareEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["plugshare-status"],
    queryFn: () => getPlugshareStatusFn(),
    staleTime: Infinity,
    retry: false,
  });
  return Boolean(data?.enabled);
}

