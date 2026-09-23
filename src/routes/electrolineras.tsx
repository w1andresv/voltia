import { createFileRoute } from "@tanstack/react-router";
import { StationsApp } from "@/components/planner/stations-app";

export const Route = createFileRoute("/electrolineras")({ component: StationsApp });
