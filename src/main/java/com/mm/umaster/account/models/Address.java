package com.mm.umaster.account.models;

import lombok.Data;

import javax.persistence.*;

@Entity
@Table(name="address")
@Data
public class Address {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id")
    private Long id;

    private String country;
    private String city;
    private String street;
    private String building;
}
