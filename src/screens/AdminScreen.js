// src/screens/AdminScreen.js
import React, {
  useState, useCallback, useEffect,
} from 'react';
import {
  View, ScrollView, SafeAreaView, StatusBar, Alert, StyleSheet,
} from 'react-native';
import {
  Text, Button, Card, Surface, ActivityIndicator, Chip, useTheme,
} from 'react-native-paper';
import {
  fetchAllDealsForAdmin, removeFoodDeal, getImpactStats,
} from '../services/appDataService';
import { listUsers } from '../services/authService';
import { useAuth } from '../context/AuthContext';

export default function AdminScreen() {
  const theme = useTheme();
  const { user, logout } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [mealsSaved, setMealsSaved] = useState(0);
  const [deals, setDeals] = useState([]);
  const [users, setUsers] = useState([]);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [stats, allDeals, allUsers] = await Promise.all([
        getImpactStats(),
        fetchAllDealsForAdmin(),
        listUsers(),
      ]);
      setMealsSaved(stats.mealsSaved);
      setDeals(allDeals);
      setUsers(allUsers);
    } catch (err) {
      Alert.alert('Could not load admin data', err.message || 'Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleRemoveDeal = useCallback((dealId, item) => {
    Alert.alert('Remove listing?', `"${item}" will be taken off the marketplace.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeFoodDeal(dealId);
            setDeals((prev) => prev.filter((d) => d.id !== dealId));
          } catch (err) {
            Alert.alert('Could not remove listing', err.message || 'Please try again.');
          }
        },
      },
    ]);
  }, []);

  const merchantCount = users.filter((u) => u.role === 'merchant').length;
  const customerCount = users.filter((u) => u.role === 'customer').length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="dark-content" />
      <Surface style={styles.header} elevation={1}>
        <Text variant="titleLarge">🛠️ Admin Dashboard</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{user.email}</Text>
        <Button mode="contained" buttonColor={theme.colors.error} onPress={logout} compact style={{ marginTop: 10, alignSelf: 'flex-start' }}>
          Log Out
        </Button>
      </Surface>

      {isLoading ? (
        <ActivityIndicator size="large" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={styles.content}>
          <View style={styles.statsRow}>
            <Card style={styles.statCard} mode="contained">
              <Card.Content style={{ alignItems: 'center' }}>
                <Text variant="headlineMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>{mealsSaved}</Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Meals Saved</Text>
              </Card.Content>
            </Card>
            <Card style={styles.statCard} mode="contained">
              <Card.Content style={{ alignItems: 'center' }}>
                <Text variant="headlineMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>{deals.length}</Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Active Listings</Text>
              </Card.Content>
            </Card>
          </View>
          <View style={styles.statsRow}>
            <Card style={styles.statCard} mode="contained">
              <Card.Content style={{ alignItems: 'center' }}>
                <Text variant="headlineMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>{merchantCount}</Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Merchants</Text>
              </Card.Content>
            </Card>
            <Card style={styles.statCard} mode="contained">
              <Card.Content style={{ alignItems: 'center' }}>
                <Text variant="headlineMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>{customerCount}</Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Customers</Text>
              </Card.Content>
            </Card>
          </View>

          <Text variant="titleMedium" style={styles.sectionTitle}>All Active Listings ({deals.length})</Text>
          {deals.length === 0 ? (
            <Text style={styles.emptyText}>No active listings right now.</Text>
          ) : (
            deals.map((deal) => (
              <Card key={deal.id} style={styles.dealCard} mode="elevated">
                <Card.Content style={styles.dealCardContent}>
                  <View style={{ flex: 1 }}>
                    <Text variant="titleSmall">{deal.item}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {deal.stall} · {deal.merchantEmail}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: theme.colors.secondary, fontWeight: 'bold' }}>{deal.price}</Text>
                  </View>
                  <Button mode="contained" buttonColor={theme.colors.error} onPress={() => handleRemoveDeal(deal.id, deal.item)} compact>
                    Remove
                  </Button>
                </Card.Content>
              </Card>
            ))
          )}

          <Text variant="titleMedium" style={styles.sectionTitle}>Registered Users ({users.length})</Text>
          {users.map((u) => (
            <Card key={u.uid} style={styles.userRow} mode="elevated">
              <Card.Content style={styles.dealCardContent}>
                <View>
                  <Text variant="titleSmall">{u.name}</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{u.email}</Text>
                </View>
                <Chip
                  compact
                  style={{
                    backgroundColor: u.role === 'admin' ? theme.colors.error
                      : u.role === 'merchant' ? theme.colors.secondary : theme.colors.primaryContainer,
                  }}
                  textStyle={{ color: u.role === 'customer' ? theme.colors.onPrimaryContainer : '#fff' }}
                >
                  {u.role}
                </Chip>
              </Card.Content>
            </Card>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40 },
  content: { flex: 1, padding: 16 },
  statsRow: { flexDirection: 'row', marginBottom: 12, gap: 12 },
  statCard: { flex: 1, borderRadius: 12 },
  sectionTitle: {
    marginBottom: 12, marginTop: 16, fontWeight: 'bold',
  },
  emptyText: { fontStyle: 'italic', marginBottom: 12, opacity: 0.7 },
  dealCard: { marginBottom: 10, borderRadius: 12 },
  dealCardContent: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  userRow: { marginBottom: 10, borderRadius: 12 },
});
