export interface Database {
  operations_center: {
    Tables: {
      john_deere_connections: {
        Row: {
          id: string;
          user_id: string;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          selected_org_id: string | null;
          selected_org_name: string | null;
          preferred_area_unit: string;
          hidden_crop_names: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          selected_org_id?: string | null;
          selected_org_name?: string | null;
          preferred_area_unit?: string;
          hidden_crop_names?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          access_token?: string;
          refresh_token?: string;
          token_expires_at?: string;
          selected_org_id?: string | null;
          selected_org_name?: string | null;
          preferred_area_unit?: string;
          hidden_crop_names?: string[];
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}

export type JohnDeereConnection = Database['operations_center']['Tables']['john_deere_connections']['Row'];
