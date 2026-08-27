import axios from "axios";

const CALENDLY_API = "https://api.calendly.com";

const getHeaders = () => ({
    Authorization: `Bearer ${process.env.CALENDLY_PERSONAL_ACCESS_TOKEN}`,
    Accept: "application/json",
});

let _cachedSchedulingUrl: string | null = null;

export interface CalendlyUser {
    uri: string;
    name: string;
    email: string;
    slug: string;
    timezone: string;
    current_organization: string;
}

export interface CalendlyEventType {
    uri: string;
    name: string;
    active: boolean;
    slug: string;
    scheduling_url: string;
    duration: number;
    kind: string;
    type: string;
    profile: {
        owner: string;
        type: string;
        name: string;
    };
}

export interface CalendlyScheduledEvent {
    uri: string;
    name: string;
    status: "active" | "canceled";
    start_time: string;
    end_time: string;
    event_type: string;
    created_at: string;
    updated_at: string;
    event_memberships: Array<{
        user: string;
        user_email: string;
        user_name: string;
    }>;
    event_guests: Array<{
        email: string;
        created_at: string;
        updated_at: string;
    }>;
    location: string | null;
    cancellation: {
        canceled_by: string;
        reason: string;
        canceler_type: string;
        created_at: string;
    } | null;
}

export interface CalendlyInvitee {
    uri: string;
    name: string;
    email: string;
    timezone: string;
    status: "active" | "canceled";
    event: string;
    questions_and_answers: Array<{
        question: string;
        answer: string;
    }>;
    reschedule_url: string;
    cancel_url: string;
    no_show: boolean;
    created_at: string;
    updated_at: string;
}

export interface CalendlyPagination {
    count: number;
    next_page: string | null;
    previous_page: string | null;
    next_page_token: string | null;
    previous_page_token: string | null;
}

export const calendlyService = {
    async getMe(): Promise<CalendlyUser> {
        const response = await axios.get(`${CALENDLY_API}/users/me`, {
            headers: getHeaders(),
        });
        return response.data.resource;
    },

    async getEventTypes(userUri?: string): Promise<CalendlyEventType[]> {
        const user = userUri || process.env.CALENDLY_USER_URI;
        const response = await axios.get(`${CALENDLY_API}/event_types`, {
            headers: getHeaders(),
            params: {
                user,
                active: true,
                count: 100,
            },
        });
        return response.data.collection;
    },

    async getScheduledEvents(params: {
        userUri?: string;
        orgUri?: string;
        status?: "active" | "canceled";
        minStartTime?: string;
        maxStartTime?: string;
        inviteeEmail?: string;
        count?: number;
        pageToken?: string;
    }): Promise<{ collection: CalendlyScheduledEvent[]; pagination: CalendlyPagination }> {
        const queryParams: Record<string, string> = {};

        if (params.userUri || process.env.CALENDLY_USER_URI) {
            queryParams.user = params.userUri || process.env.CALENDLY_USER_URI!;
        }
        if (params.orgUri || process.env.CALENDLY_ORG_URI) {
            queryParams.organization = params.orgUri || process.env.CALENDLY_ORG_URI!;
        }
        if (params.status) queryParams.status = params.status;
        if (params.minStartTime) queryParams.min_start_time = params.minStartTime;
        if (params.maxStartTime) queryParams.max_start_time = params.maxStartTime;
        if (params.inviteeEmail) queryParams.invitee_email = params.inviteeEmail;
        if (params.count) queryParams.count = String(params.count);
        if (params.pageToken) queryParams.page_token = params.pageToken;

        const response = await axios.get(`${CALENDLY_API}/scheduled_events`, {
            headers: getHeaders(),
            params: queryParams,
        });

        return {
            collection: response.data.collection,
            pagination: response.data.pagination,
        };
    },

    async getEventInvitees(
        eventUuid: string,
        pageToken?: string
    ): Promise<{ collection: CalendlyInvitee[]; pagination: CalendlyPagination }> {
        const params: Record<string, string> = { status: "active" };
        if (pageToken) params.page_token = pageToken;

        const response = await axios.get(
            `${CALENDLY_API}/scheduled_events/${eventUuid}/invitees`,
            {
                headers: getHeaders(),
                params,
            }
        );

        return {
            collection: response.data.collection,
            pagination: response.data.pagination,
        };
    },

    async getEventInviteesAll(eventUuid: string): Promise<CalendlyInvitee[]> {
        const allInvitees: CalendlyInvitee[] = [];
        let pageToken: string | undefined;

        do {
            const result = await this.getEventInvitees(eventUuid, pageToken);
            allInvitees.push(...result.collection);
            pageToken = result.pagination.next_page_token || undefined;
        } while (pageToken);

        return allInvitees;
    },

    async getAllScheduledEvents(params: {
        status?: "active" | "canceled";
        minStartTime?: string;
        maxStartTime?: string;
        afterUpdatedAt?: string;
    }): Promise<CalendlyScheduledEvent[]> {
        const allEvents: CalendlyScheduledEvent[] = [];
        let pageToken: string | undefined;

        do {
            const result = await this.getScheduledEvents({
                status: params.status,
                minStartTime: params.minStartTime,
                maxStartTime: params.maxStartTime,
                count: 100,
                pageToken,
            });
            allEvents.push(...result.collection);
            pageToken = result.pagination.next_page_token || undefined;
        } while (pageToken);

        return allEvents;
    },

    async getSchedulingUrl(): Promise<string> {
        if (_cachedSchedulingUrl) {
            return _cachedSchedulingUrl;
        }

        const eventTypeUri = process.env.CALENDLY_EVENT_TYPE_URI;
        if (!eventTypeUri) {
            throw new Error("CALENDLY_EVENT_TYPE_URI is not configured");
        }

        try {
            const eventUuid = eventTypeUri.split("/").pop();
            const response = await axios.get(`${CALENDLY_API}/event_types/${eventUuid}`, {
                headers: getHeaders(),
            });
            const schedulingUrl = response.data.resource.scheduling_url;
            if (schedulingUrl) {
                _cachedSchedulingUrl = schedulingUrl;
                console.log(`[Calendly] Fetched scheduling URL: ${schedulingUrl}`);
                return schedulingUrl;
            }
        } catch (error: any) {
            console.error("[Calendly] Failed to fetch scheduling URL from API:", error.message);
        }

        // Fallback: construct a best-effort URL
        const userUri = process.env.CALENDLY_USER_URI || "";
        const userSlug = userUri.split("/").pop() || "";
        const slug = eventTypeUri.split("/").pop() || "";
        const fallbackUrl = `https://calendly.com/${userSlug}/${slug}`;
        console.log(`[Calendly] Using fallback scheduling URL: ${fallbackUrl}`);
        return fallbackUrl;
    },

    extractUuidFromUri(uri: string): string {
        const parts = uri.split("/");
        return parts[parts.length - 1];
    },

    formatEventDate(isoString: string): string {
        const date = new Date(isoString);
        return date.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
        });
    },

    formatEventTime(isoString: string): string {
        const date = new Date(isoString);
        return date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: "UTC",
        });
    },

    calculateDurationMinutes(startTime: string, endTime: string): number {
        const start = new Date(startTime);
        const end = new Date(endTime);
        return Math.round((end.getTime() - start.getTime()) / 60000);
    },
};
