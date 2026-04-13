import { randomUUID } from "node:crypto";
import { store } from "./blobs";
import {
  ServicesSchema,
  WorkingHoursSchema,
  SettingsSchema,
  ParallelPairsSchema,
  BlocksSchema,
  type Service,
  type WorkingHours,
  type Settings,
  type ParallelPair,
  type Block,
} from "./schemas";
import { DEFAULT_SERVICES, DEFAULT_WORKING_HOURS, DEFAULT_PARALLEL_PAIRS } from "./defaults";

const KEY_SERVICES = "config/services.json";
const KEY_HOURS = "config/working-hours.json";
const KEY_SETTINGS = "config/settings.json";
const KEY_PAIRS = "config/parallel-pairs.json";
const KEY_BLOCKS = "config/blocks.json";

export async function getServices(): Promise<Service[]> {
  const raw = await store().getJSON<unknown>(KEY_SERVICES);
  if (raw == null) return DEFAULT_SERVICES;
  return ServicesSchema.parse(raw);
}
export async function setServices(services: Service[]): Promise<void> {
  const validated = ServicesSchema.parse(services);
  await store().setJSON(KEY_SERVICES, validated);
}

export async function getWorkingHours(): Promise<WorkingHours> {
  const raw = await store().getJSON<unknown>(KEY_HOURS);
  if (raw == null) return DEFAULT_WORKING_HOURS;
  return WorkingHoursSchema.parse(raw);
}
export async function setWorkingHours(hours: WorkingHours): Promise<void> {
  const validated = WorkingHoursSchema.parse(hours);
  await store().setJSON(KEY_HOURS, validated);
}

export async function getSettings(): Promise<Settings> {
  const raw = await store().getJSON<unknown>(KEY_SETTINGS);
  return SettingsSchema.parse(raw ?? {});
}
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  await store().setJSON(KEY_SETTINGS, next);
  return next;
}

export async function getParallelPairs(): Promise<ParallelPair[]> {
  const raw = await store().getJSON<unknown>(KEY_PAIRS);
  if (raw == null) return DEFAULT_PARALLEL_PAIRS;
  return ParallelPairsSchema.parse(raw);
}
export async function setParallelPairs(pairs: ParallelPair[]): Promise<void> {
  const validated = ParallelPairsSchema.parse(pairs);
  await store().setJSON(KEY_PAIRS, validated);
}

export async function getBlocks(): Promise<Block[]> {
  const raw = await store().getJSON<unknown>(KEY_BLOCKS);
  if (raw == null) return [];
  return BlocksSchema.parse(raw);
}
export async function addBlock(input: Omit<Block, "id">): Promise<Block> {
  const current = await getBlocks();
  const block: Block = { id: randomUUID(), ...input };
  const next = BlocksSchema.parse([...current, block]);
  await store().setJSON(KEY_BLOCKS, next);
  return block;
}
export async function removeBlock(id: string): Promise<void> {
  const current = await getBlocks();
  const next = current.filter((b) => b.id !== id);
  await store().setJSON(KEY_BLOCKS, next);
}
