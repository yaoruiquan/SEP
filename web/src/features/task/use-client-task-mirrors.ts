'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
export interface ClientTaskMirror { id:string; clientTaskId:string; clientRunId:string; userId:string; enterpriseId:string|null; subscriptionId:string; title:string; taskType:string; modelId:string|null; status:string; progress:number; currentStep:string|null; activity:string|null; errorSummary:string|null; clientVersion:string|null; lastSequence:number; lastHeartbeatAt:string|null; startedAt:string|null; completedAt:string|null; createdAt:string; updatedAt:string }
export interface ClientTaskMirrorEvent { id:string; sequence:number; type:string; stepKey:string|null; message:string|null; progress:number|null; occurredAt:string|null; createdAt:string }
export function useClientTaskMirrors(enabled=true){return useQuery({queryKey:qk.clientTaskMirrors,queryFn:()=>api.get<ClientTaskMirror[]>('/client/tasks'),enabled,refetchInterval:15000});}
export function useClientTaskMirror(id:string,enabled=true){return useQuery({queryKey:qk.clientTaskMirror(id),queryFn:()=>api.get<ClientTaskMirror & {events:ClientTaskMirrorEvent[]}>(`/client/tasks/${id}`),enabled:enabled&&Boolean(id),refetchInterval:10000});}
