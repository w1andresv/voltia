import { createFileRoute } from "@tanstack/react-router";
import { PlannerApp } from "@/components/planner/planner-app";

export const Route = createFileRoute("/")({ component: PlannerApp });
