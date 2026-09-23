/** Network and scheduler boundaries for a restored, potentially live-data dump. */
export function restoreContainerArguments({ name, image, password }) {
  if (!/^terroir-restore-drill-[0-9]+$/u.test(name)) {
    throw new Error("Restore requires its own disposable container name.");
  }
  return [
    "run", "-d", "--rm", "--name", name,
    "--network", "none",
    "-e", `POSTGRES_PASSWORD=${password}`,
    image, "postgres", "-D", "/etc/postgresql",
    "-c", "cron.launch_active_jobs=off",
  ];
}

export function assertRestoreContainerIsolation(inspect, cronState) {
  const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
  const observed = {
    network: networks.join(","),
    published_ports: Object.values(inspect?.NetworkSettings?.Ports ?? {}).flat().filter(Boolean).length,
    host_bind_mounts: (inspect?.Mounts ?? []).filter((mount) => mount.Type === "bind").length,
    cron_active_jobs: cronState.trim() !== "off",
  };
  if (inspect?.HostConfig?.NetworkMode !== "none" ||
      networks.length !== 1 || networks[0] !== "none" ||
      Object.keys(inspect?.HostConfig?.PortBindings ?? {}).length !== 0 ||
      observed.published_ports !== 0 || observed.host_bind_mounts !== 0 ||
      observed.cron_active_jobs) {
    throw new Error("Restore requires no network, published ports or host bind mounts, and cron disabled.");
  }
  return observed;
}
