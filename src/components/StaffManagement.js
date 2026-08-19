// src/components/StaffManagement.js
//
// Owner-only: list staff assigned to this owner, reassign which stall each
// one is linked to. No `verified` toggle here — that field is unused for
// staff by design (see isActiveStaff() in firestore.rules).
import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Portal, Modal, Text, Button, Card, Menu, ActivityIndicator, useTheme,
} from 'react-native-paper';
import { listStaffForOwner, listStalls, setStaffStall } from '../services/authService';

function StaffRow({
  staffMember, stalls, theme, onReassign,
}) {
  const [menuVisible, setMenuVisible] = useState(false);
  const currentStall = stalls.find((s) => s.id === staffMember.assignedStallId);

  return (
    <Card style={styles.card} mode="outlined">
      <Card.Content style={styles.cardContent}>
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall">{staffMember.name}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{staffMember.email}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
            {currentStall ? currentStall.stallName : 'No stall assigned'}
          </Text>
        </View>
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={<Button mode="outlined" compact onPress={() => setMenuVisible(true)}>Assign</Button>}
        >
          {stalls.map((s) => (
            <Menu.Item
              key={s.id}
              title={s.stallName}
              onPress={() => { setMenuVisible(false); onReassign(staffMember.uid, s.id); }}
            />
          ))}
          <Menu.Item title="Unassign" onPress={() => { setMenuVisible(false); onReassign(staffMember.uid, null); }} />
        </Menu>
      </Card.Content>
    </Card>
  );
}

export default function StaffManagement({ visible, onDismiss, ownerUid }) {
  const theme = useTheme();
  const [staff, setStaff] = useState([]);
  const [stalls, setStalls] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffList, stallList] = await Promise.all([
        listStaffForOwner(ownerUid),
        listStalls(ownerUid),
      ]);
      setStaff(staffList);
      setStalls(stallList);
    } finally {
      setLoading(false);
    }
  }, [ownerUid]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const handleReassign = useCallback(async (staffUid, stallId) => {
    await setStaffStall(staffUid, stallId);
    setStaff((prev) => prev.map((s) => (s.uid === staffUid ? { ...s, assignedStallId: stallId } : s)));
  }, []);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium" style={styles.title}>Your staff</Text>

        {loading ? (
          <ActivityIndicator style={{ marginVertical: 20 }} />
        ) : staff.length === 0 ? (
          <Text style={styles.empty}>
            No staff yet — they sign up with your email as &quot;stall owner&quot;.
          </Text>
        ) : (
          staff.map((s) => (
            <StaffRow key={s.uid} staffMember={s} stalls={stalls} theme={theme} onReassign={handleReassign} />
          ))
        )}

        <Button mode="text" onPress={onDismiss} style={{ marginTop: 10 }}>Close</Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20, padding: 20, borderRadius: 12, maxHeight: '85%',
  },
  title: { textAlign: 'center', marginBottom: 12 },
  empty: { fontStyle: 'italic', opacity: 0.7, textAlign: 'center', marginVertical: 12 },
  card: { marginBottom: 10 },
  cardContent: { flexDirection: 'row', alignItems: 'center' },
});
