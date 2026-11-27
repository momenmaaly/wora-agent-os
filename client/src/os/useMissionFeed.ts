import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  osApi, type MissionDetail, type MissionSummary, type TaskLease, type VerificationRecord,
} from './api.js';

const ACTIVE_STATUSES = new Set<MissionSummary['status']>(['planning', 'running', 'paused', 'awaiting_approval']);

function byUpdatedDesc(a: MissionSummary, b: MissionSummary) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function pickMission(missions: MissionSummary[]): MissionSummary | null {
  const active = missions.filter((mission) => ACTIVE_STATUSES.has(mission.status)).sort(byUpdatedDesc);
  return active[0] ?? [...missions].sort(byUpdatedDesc)[0] ?? null;
}

export interface MissionFeed {
  missions: MissionSummary[] | null;
  selectedId: string | null;
  selected: MissionSummary | null;
  detail: MissionDetail | null;
  leases: TaskLease[];
  verifications: VerificationRecord[];
  loading: boolean;
  detailLoading: boolean;
  error: unknown;
  selectMission: (id: string) => void;
  refresh: () => Promise<void>;
  refreshDetail: () => Promise<void>;
  launch: (objective: string, track?: string, clarifications?: Array<{ questionId: string; answer: string }>) => Promise<MissionDetail>;
}

/** Shared mission list/detail feed for workspace, workflow, log and artifact surfaces. */
export function useMissionFeed(): MissionFeed {
  const [missions, setMissions] = useState<MissionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [leases, setLeases] = useState<TaskLease[]>([]);
  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await osApi.missions();
      setMissions(list);
      setSelectedId((current) => current && list.some((mission) => mission.id === current) ? current : pickMission(list)?.id ?? null);
      setError(null);
    } catch (err) {
      setMissions([]);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      setLeases([]);
      setVerifications([]);
      return;
    }
    setDetailLoading(true);
    try {
      const [mission, leaseList, verificationList] = await Promise.all([
        osApi.mission(selectedId),
        osApi.missionLeases(selectedId),
        osApi.missionVerifications(selectedId),
      ]);
      setDetail(mission);
      setLeases(leaseList);
      setVerifications(verificationList);
    } catch {
      // A poll can fail while the mission is still being written; keep the last snapshot.
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshDetail(); }, [refreshDetail]);

  const anyActive = useMemo(() => (missions ?? []).some((mission) => ACTIVE_STATUSES.has(mission.status)), [missions]);
  useEffect(() => {
    if (!anyActive) return;
    const timer = window.setInterval(() => {
      void refresh();
      void refreshDetail();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [anyActive, refresh, refreshDetail]);

  const launch = useCallback(async (objective: string, track?: string, clarifications?: Array<{ questionId: string; answer: string }>) => {
    const created = await osApi.launchMission(objective, track, clarifications);
    setSelectedId(created.id);
    setDetail(created);
    setError(null);
    await refresh();
    return created;
  }, [refresh]);

  const selected = useMemo(
    () => detail ?? missions?.find((mission) => mission.id === selectedId) ?? null,
    [detail, missions, selectedId],
  );

  return {
    missions,
    selectedId,
    selected,
    detail,
    leases,
    verifications,
    loading,
    detailLoading,
    error,
    selectMission: setSelectedId,
    refresh,
    refreshDetail,
    launch,
  };
}
