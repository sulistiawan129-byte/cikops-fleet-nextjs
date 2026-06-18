import { supabase } from "./supabaseClient";
import type {
  Driver,
  Employee,
  JobType,
  TaskDetail,
  TaskStatus,
  Vehicle,
} from "./types";

/* ════════════════════════════════════════════════════════════
   MASTER DATA
════════════════════════════════════════════════════════════ */

export async function getDrivers(): Promise<Driver[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, nama, no_hp, avatar_emoji, aktif")
    .eq("aktif", true)
    .order("nama", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, nopol, jenis, aktif")
    .eq("aktif", true)
    .order("nopol", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, nik, nama, departement")
    .order("nama", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getJobTypes(): Promise<JobType[]> {
  const { data, error } = await supabase
    .from("job_types")
    .select("id, label")
    .order("label", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ════════════════════════════════════════════════════════════
   AUTH (PIN) — via RPC, pin_hash tidak pernah keluar dari DB
════════════════════════════════════════════════════════════ */

export async function verifyDriverPin(
  driverId: string,
  pin: string
): Promise<Driver | null> {
  const { data, error } = await supabase.rpc("verify_driver_pin", {
    p_driver_id: driverId,
    p_pin: pin,
  });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return { ...data[0], aktif: true } as Driver;
}

export async function changeDriverPin(
  driverId: string,
  oldPin: string,
  newPin: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_driver_pin", {
    p_driver_id: driverId,
    p_old_pin: oldPin,
    p_new_pin: newPin,
  });
  if (error) throw error;
  return Boolean(data);
}

/* ════════════════════════════════════════════════════════════
   TASKS — driver panel
════════════════════════════════════════════════════════════ */

export async function getDriverTasksToday(
  driverId: string
): Promise<TaskDetail[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("tasks_detail")
    .select("*")
    .eq("driver_id", driverId)
    .eq("tanggal", today)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getDriverHistory(
  driverId: string,
  dateFrom: string,
  dateTo: string
): Promise<TaskDetail[]> {
  const { data, error } = await supabase
    .from("tasks_detail")
    .select("*")
    .eq("driver_id", driverId)
    .gte("tanggal", dateFrom)
    .lte("tanggal", dateTo)
    .order("tanggal", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function acceptTask(
  taskId: string,
  driverId: string
): Promise<void> {
  const { error } = await supabase.rpc("accept_task", {
    p_task_id: taskId,
    p_driver_id: driverId,
  });
  if (error) throw error;
}

export async function completeTask(
  taskId: string,
  driverId: string
): Promise<void> {
  const { error } = await supabase.rpc("complete_task", {
    p_task_id: taskId,
    p_driver_id: driverId,
  });
  if (error) throw error;
}

export async function cancelTaskByDriver(
  taskId: string,
  driverId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc("cancel_task", {
    p_task_id: taskId,
    p_driver_id: driverId,
    p_reason: reason || null,
  });
  if (error) throw error;
}

/* ════════════════════════════════════════════════════════════
   TASKS — dashboard admin
════════════════════════════════════════════════════════════ */

export async function getTasksByDate(
  dateFilter: string
): Promise<TaskDetail[]> {
  const { data, error } = await supabase
    .from("tasks_detail")
    .select("*")
    .eq("tanggal", dateFilter)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getTasksByRange(
  dateFrom: string,
  dateTo: string
): Promise<TaskDetail[]> {
  const { data, error } = await supabase
    .from("tasks_detail")
    .select("*")
    .gte("tanggal", dateFrom)
    .lte("tanggal", dateTo)
    .order("tanggal", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface CreateTaskInput {
  tanggal: string;
  driver_id: string;
  vehicle_id: string;
  jenis_pekerjaan: string;
  tujuan: string;
  requestor: string;
  departement: string;
  perihal?: string;
}

export async function createTask(input: CreateTaskInput): Promise<void> {
  const { error } = await supabase.from("tasks").insert({
    tanggal: input.tanggal,
    driver_id: input.driver_id,
    vehicle_id: input.vehicle_id,
    jenis_pekerjaan: input.jenis_pekerjaan,
    tujuan: input.tujuan,
    requestor: input.requestor,
    departement: input.departement,
    perihal: input.perihal || "",
    status: "ASSIGNED",
  });
  if (error) throw error;
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "ON GOING") patch.accepted_at = new Date().toISOString();
  if (status === "DONE") patch.completed_at = new Date().toISOString();
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw error;
}

export async function cancelTaskByAdmin(
  taskId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({
      status: "CANCELLED",
      cancelled_at: new Date().toISOString(),
      cancelled_by: "admin",
      cancel_reason: reason || null,
    })
    .eq("id", taskId);
  if (error) throw error;
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
}

/* ════════════════════════════════════════════════════════════
   REALTIME SUBSCRIPTION
════════════════════════════════════════════════════════════ */

export function subscribeToTasks(onChange: () => void) {
  const channel = supabase
    .channel("tasks-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tasks" },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
