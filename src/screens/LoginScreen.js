// src/screens/LoginScreen.js
import React, { useState, useCallback } from 'react';
import {
  SafeAreaView, ScrollView, StyleSheet, View, StatusBar,
} from 'react-native';
import {
  TextInput, Button, Text, Surface, SegmentedButtons, Checkbox, Dialog, Portal, useTheme,
} from 'react-native-paper';
import { useAuth } from '../context/AuthContext';
import { TERMS_TEXT } from '../utils/terms';

export default function LoginScreen() {
  const theme = useTheme();
  const { login, signUp } = useAuth();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('customer');
  const [assignedOwnerEmail, setAssignedOwnerEmail] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter an email and password.');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (mode === 'signup' && role === 'staff' && !assignedOwnerEmail.trim()) {
      setError("Please enter your stall owner's email.");
      return;
    }
    if (mode === 'signup' && !agreedToTerms) {
      setError('Please agree to the terms to continue.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await signUp({
          name,
          email: email.trim(),
          password,
          role,
          agreedToTerms,
          assignedOwnerEmail: role === 'staff' ? assignedOwnerEmail.trim() : undefined,
        });
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [mode, name, email, password, role, assignedOwnerEmail, agreedToTerms, login, signUp]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Surface style={styles.headerSurface} elevation={1}>
          <Text variant="displaySmall" style={styles.emoji}>♻️</Text>
          <Text variant="headlineSmall" style={styles.title}>KampongCycle</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            Rescuing surplus hawker food, one meal at a time
          </Text>
          <Text variant="labelLarge" style={{ marginTop: 12, color: theme.colors.primary }}>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </Text>
        </Surface>

        {!!error && (
          <Surface style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]} elevation={0}>
            <Text style={{ color: theme.colors.onErrorContainer }}>⚠️ {error}</Text>
          </Surface>
        )}

        {mode === 'signup' && (
          <TextInput
            label="Name"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
          />
        )}

        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          mode="outlined"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />

        <TextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          mode="outlined"
          secureTextEntry
          style={styles.input}
        />

        {mode === 'signup' && (
          <View style={styles.roleContainer}>
            <Text variant="labelLarge" style={styles.roleLabel}>I am a:</Text>
            <SegmentedButtons
              value={role}
              onValueChange={setRole}
              buttons={[
                { value: 'customer', label: 'Customer', icon: 'account' },
                { value: 'owner', label: 'Stall owner', icon: 'storefront' },
                { value: 'staff', label: 'Staff', icon: 'account-hard-hat' },
              ]}
            />
          </View>
        )}

        {mode === 'signup' && role === 'staff' && (
          <TextInput
            label="Your stall owner's email"
            value={assignedOwnerEmail}
            onChangeText={setAssignedOwnerEmail}
            mode="outlined"
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
        )}

        {mode === 'signup' && (
          <View style={styles.termsRow}>
            <Checkbox
              status={agreedToTerms ? 'checked' : 'unchecked'}
              onPress={() => setAgreedToTerms((v) => !v)}
            />
            <Text
              variant="bodySmall"
              style={{ flex: 1 }}
              onPress={() => setAgreedToTerms((v) => !v)}
            >
              I agree to the{' '}
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
                onPress={() => setTermsVisible(true)}
              >
                Terms & Community Guidelines
              </Text>
            </Text>
          </View>
        )}

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={isSubmitting}
          style={styles.submitButton}
          contentStyle={{ paddingVertical: 4 }}
        >
          {mode === 'login' ? 'Log In' : 'Sign Up'}
        </Button>

        <Button
          mode="text"
          onPress={() => { setError(''); setMode(mode === 'login' ? 'signup' : 'login'); }}
          style={styles.toggleButton}
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </Button>
      </ScrollView>

      <Portal>
        <Dialog visible={termsVisible} onDismiss={() => setTermsVisible(false)}>
          <Dialog.Title>Terms & Community Guidelines</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
              <Text variant="bodySmall">{TERMS_TEXT}</Text>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setTermsVisible(false)}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24, paddingTop: 48 },
  headerSurface: {
    padding: 24, borderRadius: 16, marginBottom: 24, alignItems: 'center',
  },
  emoji: { marginBottom: 4 },
  title: { fontWeight: 'bold', marginBottom: 4 },
  errorBanner: { padding: 12, borderRadius: 12, marginBottom: 16 },
  input: { marginBottom: 12 },
  roleContainer: { marginTop: 8, marginBottom: 16 },
  roleLabel: { marginBottom: 8 },
  termsRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 8,
  },
  submitButton: { marginTop: 8, borderRadius: 24 },
  toggleButton: { marginTop: 8 },
});
