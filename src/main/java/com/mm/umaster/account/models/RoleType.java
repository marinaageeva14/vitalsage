package com.mm.umaster.account.models;

import org.springframework.security.core.GrantedAuthority;

public enum RoleType implements GrantedAuthority {
    ROLE_MASTER,
    ROLE_USER;

    @Override
    public String getAuthority() {
        return name();
    }
}
