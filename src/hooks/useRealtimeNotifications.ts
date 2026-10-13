import { useEffect, useRef, useCallback } from 'react';
import { supabase, type Notification, type Registration, type Department } from '@/lib/supabase';
import { fetchNotifications, fetchRegistrations } from '@/lib/api';

type Props = {
  department: Department | null;
  enabled: boolean;
  onNewNotification: (notification: Notification) => void;
  onInitialNotifications: (notifications: Notification[]) => void;
};

function matchesDepartment(notification: Notification, department: Department | null): boolean {
  if (notification.department === null) return true;
  if (!department) return true;
  if (notification.department === department) return true;
  if (notification.department === 'مشترك') return true;
  return false;
}

export function useRealtimeNotifications({
  department,
  enabled,
  onNewNotification,
  onInitialNotifications,
}: Props) {
  const onNewRef = useRef(onNewNotification);
  const onInitialRef = useRef(onInitialNotifications);
  const knownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    onNewRef.current = onNewNotification;
    onInitialRef.current = onInitialNotifications;
  }, [onNewNotification, onInitialNotifications]);

  const handleNewRow = useCallback((row: Notification) => {
    if (knownIds.current.has(row.id)) return;
    knownIds.current.add(row.id);
    if (matchesDepartment(row, department)) {
      onNewRef.current(row);
    }
  }, [department]);

  useEffect(() => {
    if (!enabled) return;

    knownIds.current = new Set();

    fetchNotifications(department ?? undefined)
      .then((notifications) => {
        for (const n of notifications) {
          knownIds.current.add(n.id);
        }
        onInitialRef.current(notifications);
      })
      .catch(() => {});

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          handleNewRow(payload.new as Notification);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications' },
        (payload) => {
          knownIds.current.delete((payload.old as Notification).id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, department, handleNewRow]);
}

type RegistrationProps = {
  enabled: boolean;
  onNewRegistration: (registration: Registration) => void;
  onInitialRegistrations: (registrations: Registration[]) => void;
};

export function useRealtimeRegistrations({
  enabled,
  onNewRegistration,
  onInitialRegistrations,
}: RegistrationProps) {
  const onNewRef = useRef(onNewRegistration);
  const onInitialRef = useRef(onInitialRegistrations);
  const knownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    onNewRef.current = onNewRegistration;
    onInitialRef.current = onInitialRegistrations;
  }, [onNewRegistration, onInitialRegistrations]);

  useEffect(() => {
    if (!enabled) return;

    knownIds.current = new Set();

    fetchRegistrations()
      .then((registrations) => {
        for (const r of registrations) {
          knownIds.current.add(r.id);
        }
        onInitialRef.current(registrations);
      })
      .catch(() => {});

    const channel = supabase
      .channel('registrations-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'registrations' },
        (payload) => {
          const row = payload.new as Registration;
          if (knownIds.current.has(row.id)) return;
          knownIds.current.add(row.id);
          onNewRef.current(row);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
